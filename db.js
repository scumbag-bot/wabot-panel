const mysql = require('mysql2');

const pool = mysql.createPool({
  host: "localhost",
  user: "u5685439_appgk",
  password: "#appgk123123",
  database: "u5685439_appgk"
}).promise();

// Fetch due messages
async function getDueMessages() {
    const [rows] = await pool.query(
        "SELECT * FROM scheduled_messages WHERE send_time <= NOW()"
    );
    return rows;
}

// Delete one-time message
async function deleteMessage(id) {
    await pool.query("DELETE FROM scheduled_messages WHERE id = ?", [id]);
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

    const nextTime = next.toISOString().slice(0, 19).replace('T', ' ');
    await pool.query(
        "UPDATE scheduled_messages SET send_time = ? WHERE id = ?",
        [nextTime, id]
    );
}

module.exports = { getDueMessages, deleteMessage, updateNextSchedule };