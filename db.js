const { Pool } = require('pg');

const pool = new Pool({
    host: "localhost",
    user: "u5685439_appgk",
    password: "#appgk123123",
    database: "whatsappbotdb",
    port: 5432, // Default PostgreSQL port
});

// Fetch due messages
async function getDueMessages() {
    console.log("Fetching due messages from the database...");
    const res = await pool.query(
            "SELECT * FROM scheduled_messages WHERE send_time <= NOW()"
    );
    console.log(`Found ${res.rowCount} due messages.`);
    return res.rows;
}

// Delete one-time message
async function deleteMessage(id) {
        await pool.query("DELETE FROM scheduled_messages WHERE id = $1", [id]);
}

// Reschedule recurring messages
async function updateNextSchedule(id, currentSendTime, recurrence) {
    const next = new Date(currentSendTime);
    next.setHours(next.getHours() + 7); // Assuming timezone offset of +7 hours
    console.log(`Current send time: ${currentSendTime}, Recurrence: ${recurrence}`);
    switch (recurrence) {
        case 'daily':
            next.setDate(next.getDate() + 1);
            break;
        case 'weekly':
            next.setDate(next.getDate() + 7);
            break;
        case 'monthly':
            next.setMonth(next.getMonth() + 1);
            break;
        default:
            return;
    }

    const nextTime = next.toISOString();
    await pool.query(
            "UPDATE scheduled_messages SET send_time = $1 WHERE id = $2",
            [nextTime, id]
    );
}

async function addMessage(data) {
    const { phone, type, msg, send_time, recurrence } = data;
    if (!phone || !msg || !send_time) {
        throw new Error("Phone, message, and send_time are required.");
    }
    const mentions = data.mentions || null; // Optional field

    await pool.query(
        "INSERT INTO scheduled_messages (recipient, mentions, type, message, send_time, recurrence) VALUES ($1, $2, $3, $4, $5, $6)",
        [phone,mentions ,type,msg, send_time, recurrence]
    );
}

async function getMessages(phone) {
    const res = await pool.query(
        "SELECT * FROM scheduled_messages"
    );
    return res.rows;
}

module.exports = { getDueMessages, deleteMessage, updateNextSchedule, addMessage, getMessages };
