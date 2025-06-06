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

module.exports = { getDueMessages, deleteMessage, updateNextSchedule };
