// SenderKey Auto-Heal & Monitor Module for Baileys
const { delay } = require('@whiskeysockets/baileys');

async function ensureSenderKey(sock, groupId) {
    try {
        console.log(`[SenderKey Monitor] Checking SenderKey for group: ${groupId}`);

        await sock.presenceSubscribe(groupId);
        await delay(1000);

        await sock.groupMetadata(groupId);
        await delay(1000);

        await sock.sendReadReceipt(groupId, null, [null]);
        await delay(1000);

        console.log(`[SenderKey Monitor] Completed sync attempts for group: ${groupId}`);

    } catch (error) {
        console.error(`[SenderKey Monitor] Error while syncing SenderKey for ${groupId}:`, error);
    }
}

async function sendMessageWithHeal(sock, groupId, messageContent, mentions = [], res = null) {
    try {
        const result = await sock.sendMessage(groupId, { text: messageContent, mentions: mentions });
        console.log(`[SenderKey Monitor] Message sent successfully to ${groupId}`);
        
        if (res) {
            res.status(200).json({
                status: true,
                response: result
            });
        }
    } catch (err) {
        if (err.message.includes('mac')) {
            console.warn(`[SenderKey Monitor] Bad MAC error detected on ${groupId}. Attempting to auto-heal.`);
            await ensureSenderKey(sock, groupId);

            console.log(`[SenderKey Monitor] Retrying to send message after healing...`);
            await delay(2000);

            try {
                const retryResult = await sock.sendMessage(groupId, { text: messageContent, mentions: mentions });
                console.log(`[SenderKey Monitor] Message sent successfully after healing.`);

                if (res) {
                    res.status(200).json({
                        status: true,
                        response: retryResult
                    });
                }
            } catch (retryErr) {
                console.error(`[SenderKey Monitor] Failed to send message even after healing:`, retryErr);

                if (res) {
                    res.status(500).json({
                        status: false,
                        response: retryErr.message || 'Failed to send after healing. Manual intervention needed.'
                    });
                }
            }
        } else {
            console.error(`[SenderKey Monitor] Failed to send message:`, err);

            if (res) {
                res.status(500).json({
                    status: false,
                    response: err.message
                });
            }
        }
    }
}

module.exports = {
    sendMessageWithHeal
};
