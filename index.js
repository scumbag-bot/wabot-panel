const {
    default: makeWASocket,
    MessageType,
    MessageOptions,
    Mimetype,
    DisconnectReason,
    BufferJSON,
    AnyMessageContent,
    delay,
    fetchLatestBaileysVersion,
    isJidBroadcast,
    makeCacheableSignalKeyStore,
    makeInMemoryStore,
    MessageRetryMap,
    useMultiFileAuthState,
    msgRetryCounterMap
} = require("@whiskeysockets/baileys");

const log = (pino = require("pino"));
const { session } = { "session": "baileys_auth_info" };
const { Boom } = require("@hapi/boom");
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const express = require("express");
const fileUpload = require('express-fileupload');
const cors = require('cors');
const cron = require("node-cron");
const { getDueMessages, deleteMessage, updateNextSchedule, getMessages, addMessage } = require('./db.js');
const bodyParser = require("body-parser");
const app = require("express")()
// enable files upload
app.use(fileUpload({
    createParentPath: true
}));

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
const server = require("http").createServer(app);
const io = require("socket.io")(server);
const port = process.env.PORT || 8000;
const qrcode = require("qrcode");

app.use("/assets", express.static(__dirname + "/client/assets"));

app.get("/scan", (req, res) => {
    res.sendFile("./client/server.html", {
        root: __dirname,
    });
});

app.get("/", (req, res) => {
    res.sendFile("./client/index.html", {
        root: __dirname,
    });
});
//fungsi suara capital 
function capital(textSound) {
    const arr = textSound.split(" ");
    for (var i = 0; i < arr.length; i++) {
        arr[i] = arr[i].charAt(0).toUpperCase() + arr[i].slice(1);
    }
    const str = arr.join(" ");
    return str;
}
const store = makeInMemoryStore({ logger: pino().child({ level: "silent", stream: "store" }) });

let sock;
let qr;
let soket;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info')
    let { version, isLatest } = await fetchLatestBaileysVersion();
    sock = makeWASocket({
        printQRInTerminal: true,
        auth: state,
        logger: log({ level: "silent" }),
        version,
        shouldIgnoreJid: jid => isJidBroadcast(jid),
    });
    store.bind(sock.ev);
    sock.multi = true
    sock.ev.on('connection.update', async (update) => {
        //console.log(update);
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            let reason = new Boom(lastDisconnect.error).output.statusCode;
            if (reason === DisconnectReason.badSession) {
                console.log(`Bad Session File, Please Delete ${session} and Scan Again`);
                sock.logout();
            } else if (reason === DisconnectReason.connectionClosed) {
                console.log("Connection closed, reconnecting....");
                connectToWhatsApp();
            } else if (reason === DisconnectReason.connectionLost) {
                console.log("Connection Lost from Server, reconnecting...");
                connectToWhatsApp();
            } else if (reason === DisconnectReason.connectionReplaced) {
                console.log("Connection Replaced, Another New Session Opened, Please Close Current Session First");
                sock.logout();
            } else if (reason === DisconnectReason.loggedOut) {
                console.log(`Device Logged Out, Please Delete ${session} and Scan Again.`);
                sock.logout();
            } else if (reason === DisconnectReason.restartRequired) {
                console.log("Restart Required, Restarting...");
                connectToWhatsApp();
            } else if (reason === DisconnectReason.timedOut) {
                console.log("Connection TimedOut, Reconnecting...");
                connectToWhatsApp();
            } else {
                sock.end(`Unknown DisconnectReason: ${reason}|${lastDisconnect.error}`);
            }
        } else if (connection === 'open') {
            console.log('opened connection');
            let getGroups = await sock.groupFetchAllParticipating();
            let groups = Object.values(await sock.groupFetchAllParticipating())
            //console.log(groups);
            for (let group of groups) {
                console.log("id_group: " + group.id + " || Nama Group: " + group.subject);
            }
            return;
        }
        if (update.qr) {
            qr = update.qr;
            updateQR("qr");
        }
        else if (qr = undefined) {
            updateQR("loading");
        }
        else {
            if (update.connection === "open") {
                updateQR("qrscanned");
                return;
            }
        }
    });
    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
        //console.log(messages);
        return;
        if (type === "notify") {
            if (!messages[0].key.fromMe) {
                //tentukan jenis pesan berbentuk text                
                const pesan = messages[0].message.conversation;

                //nowa dari pengirim pesan sebagai id
                const noWa = messages[0].key.remoteJid;

                await sock.readMessages([messages[0].key]);

                //kecilkan semua pesan yang masuk lowercase 
                const pesanMasuk = pesan.toLowerCase();

                if (!messages[0].key.fromMe && pesanMasuk === "ping") {
                    //await sock.sendMessage(noWa, { text: "Pong" }, { quoted: messages[0] });
                } else {
                    //await sock.sendMessage(noWa, { text: "Saya adalah Bot!" }, { quoted: messages[0] });
                }
            }
        }
    });

    cron.schedule('* * * * *', async () => {
        try {
            const messages = await getDueMessages();
    
            for (const msg of messages) {
                let jid;

                if (msg.type === 'personal') {
                    jid = msg.recipient.replace(/\D/g, '') + '@s.whatsapp.net';
                } else if (msg.type === 'group') {
                    jid = msg.recipient; // Already in correct group format (e.g. 123456@g.us)
                } else {
                    console.warn(`⚠️ Unknown type: ${msg.type}`);
                    continue;
                }

                try {
                    let mentionsArray = [];
                    let messageText = msg.message;

                    if (msg.mentions) {
                        const numbers = msg.mentions.split(',').map(n => n.trim());
                        mentionsArray = numbers.map(n => n.replace(/\D/g, '') + '@s.whatsapp.net');
                      
                        numbers.forEach((num, i) => {
                            const jid = num.replace(/\D/g, '') + '@s.whatsapp.net';
                            const name = sock.contacts[jid]?.name || sock.contacts[jid]?.notify || num;
                            messageText = messageText.replace(`@user${i + 1}`, `@${name}`);
                        });
                    }
                    await sock.sendMessage(jid, { text: msg.message });
                    console.log(`📤 Sent to ${msg.phone}: ${msg.message}`);
    
                    if (msg.recurrence) {
                        await updateNextSchedule(msg.id, msg.send_time, msg.recurrence);
                    } else {
                        await deleteMessage(msg.id);
                    }
    
                } catch (err) {
                    console.error(`❌ Failed to send to ${msg.phone}`, err);
                }
            }
        } catch (err) {
            console.error("❌ Error checking due messages:", err);
        }
    });
}

io.on("connection", async (socket) => {
    soket = socket;
    // console.log(sock)
    if (isConnected) {
        updateQR("connected");
    } else if (qr) {
        updateQR("qr");
    }
});

// functions
const isConnected = () => {
    return (sock.user);
};

const updateQR = (data) => {
    switch (data) {
        case "qr":
            qrcode.toDataURL(qr, (err, url) => {
                soket?.emit("qr", url);
                soket?.emit("log", "QR Code received, please scan!");
            });
            break;
        case "connected":
            soket?.emit("qrstatus", "./assets/check.svg");
            soket?.emit("log", "WhatsApp terhubung!");
            break;
        case "qrscanned":
            soket?.emit("qrstatus", "./assets/check.svg");
            soket?.emit("log", "QR Code Telah discan!");
            break;
        case "loading":
            soket?.emit("qrstatus", "./assets/loader.gif");
            soket?.emit("log", "Registering QR Code , please wait!");
            break;
        default:
            break;
    }
};

// send text message to wa user
app.post("/send-message", async (req, res) => {
    //console.log(req);
    return res.status(500).json({
        status: false,
        response: 'Fitur ini masih dalam tahap pengembangan, silahkan gunakan fitur kirim pesan ke nomor WhatsApp.'
    });
    const pesankirim = req.body.message;
    const number = req.body.number;
    const fileDikirim = req.files;

    let numberWA;
    try {
        if (!req.files) {
            if (!number) {
                res.status(500).json({
                    status: false,
                    response: 'Nomor WA belum tidak disertakan!'
                });
            }
            else {
                numberWA = '62' + number.substring(1) + "@s.whatsapp.net";
                console.log(await sock.onWhatsApp(numberWA));
                if (isConnected) {
                    const exists = await sock.onWhatsApp(numberWA);
                    if (exists?.jid || (exists && exists[0]?.jid)) {
                        sock.sendMessage(exists.jid || exists[0].jid, { text: pesankirim })
                            .then((result) => {
                                res.status(200).json({
                                    status: true,
                                    response: result,
                                });
                            })
                            .catch((err) => {
                                res.status(500).json({
                                    status: false,
                                    response: err,
                                });
                            });
                    } else {
                        res.status(500).json({
                            status: false,
                            response: `Nomor ${number} tidak terdaftar.`,
                        });
                    }
                } else {
                    res.status(500).json({
                        status: false,
                        response: `WhatsApp belum terhubung.`,
                    });
                }
            }
        }
        else {
            //console.log('Kirim document');
            if (!number) {
                res.status(500).json({
                    status: false,
                    response: 'Nomor WA belum tidak disertakan!'
                });
            }
            else {

                numberWA = '62' + number.substring(1) + "@s.whatsapp.net";
                //console.log('Kirim document ke'+ numberWA);
                let filesimpan = req.files.file_dikirim;
                var file_ubah_nama = new Date().getTime() + '_' + filesimpan.name;
                //pindahkan file ke dalam upload directory
                filesimpan.mv('./uploads/' + file_ubah_nama);
                let fileDikirim_Mime = filesimpan.mimetype;
                //console.log('Simpan document '+fileDikirim_Mime);

                //console.log(await sock.onWhatsApp(numberWA));

                if (isConnected) {
                    const exists = await sock.onWhatsApp(numberWA);

                    if (exists?.jid || (exists && exists[0]?.jid)) {

                        let namafiledikirim = './uploads/' + file_ubah_nama;
                        let extensionName = path.extname(namafiledikirim);
                        //console.log(extensionName);
                        if (extensionName === '.jpeg' || extensionName === '.jpg' || extensionName === '.png' || extensionName === '.gif') {
                            await sock.sendMessage(exists.jid || exists[0].jid, {
                                image: {
                                    url: namafiledikirim
                                },
                                caption: pesankirim
                            }).then((result) => {
                                if (fs.existsSync(namafiledikirim)) {
                                    fs.unlink(namafiledikirim, (err) => {
                                        if (err && err.code == "ENOENT") {
                                            // file doens't exist
                                            console.info("File doesn't exist, won't remove it.");
                                        } else if (err) {
                                            console.error("Error occurred while trying to remove file.");
                                        }
                                        //console.log('File deleted!');
                                    });
                                }
                                res.send({
                                    status: true,
                                    message: 'Success',
                                    data: {
                                        name: filesimpan.name,
                                        mimetype: filesimpan.mimetype,
                                        size: filesimpan.size
                                    }
                                });
                            }).catch((err) => {
                                res.status(500).json({
                                    status: false,
                                    response: err,
                                });
                                console.log('pesan gagal terkirim');
                            });
                        } else if (extensionName === '.mp3' || extensionName === '.ogg') {
                            await sock.sendMessage(exists.jid || exists[0].jid, {
                                audio: {
                                    url: namafiledikirim,
                                    caption: pesankirim
                                },
                                mimetype: 'audio/mp4'
                            }).then((result) => {
                                if (fs.existsSync(namafiledikirim)) {
                                    fs.unlink(namafiledikirim, (err) => {
                                        if (err && err.code == "ENOENT") {
                                            // file doens't exist
                                            console.info("File doesn't exist, won't remove it.");
                                        } else if (err) {
                                            console.error("Error occurred while trying to remove file.");
                                        }
                                        //console.log('File deleted!');
                                    });
                                }
                                res.send({
                                    status: true,
                                    message: 'Success',
                                    data: {
                                        name: filesimpan.name,
                                        mimetype: filesimpan.mimetype,
                                        size: filesimpan.size
                                    }
                                });
                            }).catch((err) => {
                                res.status(500).json({
                                    status: false,
                                    response: err,
                                });
                                console.log('pesan gagal terkirim');
                            });
                        } else {
                            await sock.sendMessage(exists.jid || exists[0].jid, {
                                document: {
                                    url: namafiledikirim,
                                    caption: pesankirim
                                },
                                mimetype: fileDikirim_Mime,
                                fileName: filesimpan.name
                            }).then((result) => {
                                if (fs.existsSync(namafiledikirim)) {
                                    fs.unlink(namafiledikirim, (err) => {
                                        if (err && err.code == "ENOENT") {
                                            // file doens't exist
                                            console.info("File doesn't exist, won't remove it.");
                                        } else if (err) {
                                            console.error("Error occurred while trying to remove file.");
                                        }
                                        //console.log('File deleted!');
                                    });
                                }
                                /*
                                setTimeout(() => {
                                    sock.sendMessage(exists.jid || exists[0].jid, {text: pesankirim});
                                }, 1000);
                                */
                                res.send({
                                    status: true,
                                    message: 'Success',
                                    data: {
                                        name: filesimpan.name,
                                        mimetype: filesimpan.mimetype,
                                        size: filesimpan.size
                                    }
                                });
                            }).catch((err) => {
                                res.status(500).json({
                                    status: false,
                                    response: err,
                                });
                                console.log('pesan gagal terkirim');
                            });
                        }
                    } else {
                        res.status(500).json({
                            status: false,
                            response: `Nomor ${number} tidak terdaftar.`,
                        });
                    }
                } else {
                    res.status(500).json({
                        status: false,
                        response: `WhatsApp belum terhubung.`,
                    });
                }
            }
        }
    } catch (err) {
        res.status(500).send(err);
    }

});

// send group message
app.post("/send-group-message", async (req, res) => {
    //console.log(req);
    return res.status(500).json({
        status: false,
        response: 'Fitur ini masih dalam tahap pengembangan, silahkan gunakan fitur kirim pesan ke nomor WhatsApp.'
    });
    const pesankirim = req.body.message;
    const id_group = req.body.id_group;
    const fileDikirim = req.files;
    const mentions = req.body.mentions;
    let idgroup;
    let exist_idgroup;
    try {
        if (isConnected) {
            if (!req.files) {
                if (!id_group) {
                    res.status(500).json({
                        status: false,
                        response: 'Nomor Id Group belum disertakan!'
                    });
                }
                else {
                    let exist_idgroup = await sock.groupMetadata(id_group);
                    console.log(exist_idgroup.id);
                    console.log("isConnected");
                    if (exist_idgroup?.id || (exist_idgroup && exist_idgroup[0]?.id)) {
                        if(mentions){
                        const mention_list = mentions.split(',');
                        sock.sendMessage(id_group, { text: pesankirim, mentions: mention_list })
                            .then((result) => {
                                res.status(200).json({
                                    status: true,
                                    response: result,
                                });
                                console.log("succes terkirim");
                            })
                            .catch((err) => {
                                res.status(500).json({
                                    status: false,
                                    response: err,
                                });
                                console.log("error 500");
                            });
                        }else{
                        sock.sendMessage(id_group, { text: pesankirim })
                            .then((result) => {
                                res.status(200).json({
                                    status: true,
                                    response: result,
                                });
                                console.log("succes terkirim");
                            })
                            .catch((err) => {
                                res.status(500).json({
                                    status: false,
                                    response: err,
                                });
                                console.log("error 500");
                            });
                        }
                    } else {
                        res.status(500).json({
                            status: false,
                            response: `ID Group ${id_group} tidak terdaftar.`,
                        });
                        console.log(`ID Group ${id_group} tidak terdaftar.`);
                    }
                }

            } else {
                //console.log('Kirim document');
                if (!id_group) {
                    res.status(500).json({
                        status: false,
                        response: 'Id Group tidak disertakan!'
                    });
                }
                else {
                    exist_idgroup = await sock.groupMetadata(id_group);
                    console.log(exist_idgroup.id);
                    //console.log('Kirim document ke group'+ exist_idgroup.subject);

                    let filesimpan = req.files.file_dikirim;
                    var file_ubah_nama = new Date().getTime() + '_' + filesimpan.name;
                    //pindahkan file ke dalam upload directory
                    filesimpan.mv('./uploads/' + file_ubah_nama);
                    let fileDikirim_Mime = filesimpan.mimetype;
                    //console.log('Simpan document '+fileDikirim_Mime);
                    if (isConnected) {
                        if (exist_idgroup?.id || (exist_idgroup && exist_idgroup[0]?.id)) {
                            let namafiledikirim = './uploads/' + file_ubah_nama;
                            let extensionName = path.extname(namafiledikirim);
                            //console.log(extensionName);
                            if (extensionName === '.jpeg' || extensionName === '.jpg' || extensionName === '.png' || extensionName === '.gif') {
                                await sock.sendMessage(exist_idgroup.id || exist_idgroup[0].id, {
                                    image: {
                                        url: namafiledikirim
                                    },
                                    caption: pesankirim
                                }).then((result) => {
                                    if (fs.existsSync(namafiledikirim)) {
                                        fs.unlink(namafiledikirim, (err) => {
                                            if (err && err.code == "ENOENT") {
                                                // file doens't exist
                                                console.info("File doesn't exist, won't remove it.");
                                            } else if (err) {
                                                console.error("Error occurred while trying to remove file.");
                                            }
                                            //console.log('File deleted!');
                                        });
                                    }
                                    res.send({
                                        status: true,
                                        message: 'Success',
                                        data: {
                                            name: filesimpan.name,
                                            mimetype: filesimpan.mimetype,
                                            size: filesimpan.size
                                        }
                                    });
                                }).catch((err) => {
                                    res.status(500).json({
                                        status: false,
                                        response: err,
                                    });
                                    console.log('pesan gagal terkirim');
                                });
                            } else if (extensionName === '.mp3' || extensionName === '.ogg') {
                                await sock.sendMessage(exist_idgroup.id || exist_idgroup[0].id, {
                                    audio: {
                                        url: namafiledikirim,
                                        caption: pesankirim
                                    },
                                    mimetype: 'audio/mp4'
                                }).then((result) => {
                                    if (fs.existsSync(namafiledikirim)) {
                                        fs.unlink(namafiledikirim, (err) => {
                                            if (err && err.code == "ENOENT") {
                                                // file doens't exist
                                                console.info("File doesn't exist, won't remove it.");
                                            } else if (err) {
                                                console.error("Error occurred while trying to remove file.");
                                            }
                                            //console.log('File deleted!');
                                        });
                                    }
                                    res.send({
                                        status: true,
                                        message: 'Success',
                                        data: {
                                            name: filesimpan.name,
                                            mimetype: filesimpan.mimetype,
                                            size: filesimpan.size
                                        }
                                    });
                                }).catch((err) => {
                                    res.status(500).json({
                                        status: false,
                                        response: err,
                                    });
                                    console.log('pesan gagal terkirim');
                                });
                            } else {
                                await sock.sendMessage(exist_idgroup.id || exist_idgroup[0].id, {
                                    document: {
                                        url: namafiledikirim,
                                        caption: pesankirim
                                    },
                                    mimetype: fileDikirim_Mime,
                                    fileName: filesimpan.name
                                }).then((result) => {
                                    if (fs.existsSync(namafiledikirim)) {
                                        fs.unlink(namafiledikirim, (err) => {
                                            if (err && err.code == "ENOENT") {
                                                // file doens't exist
                                                console.info("File doesn't exist, won't remove it.");
                                            } else if (err) {
                                                console.error("Error occurred while trying to remove file.");
                                            }
                                            //console.log('File deleted!');
                                        });
                                    }

                                    setTimeout(() => {
                                        sock.sendMessage(exist_idgroup.id || exist_idgroup[0].id, { text: pesankirim });
                                    }, 1000);

                                    res.send({
                                        status: true,
                                        message: 'Success',
                                        data: {
                                            name: filesimpan.name,
                                            mimetype: filesimpan.mimetype,
                                            size: filesimpan.size
                                        }
                                    });
                                }).catch((err) => {
                                    res.status(500).json({
                                        status: false,
                                        response: err,
                                    });
                                    console.log('pesan gagal terkirim');
                                });
                            }
                        } else {
                            res.status(500).json({
                                status: false,
                                response: `Nomor ${number} tidak terdaftar.`,
                            });
                        }
                    } else {
                        res.status(500).json({
                            status: false,
                            response: `WhatsApp belum terhubung.`,
                        });
                    }
                }
            }

            //end is connected
        } else {
            res.status(500).json({
                status: false,
                response: `WhatsApp belum terhubung.`,
            });
        }

        //end try
    } catch (err) {
        res.status(500).send(err);
    }

});

app.get('/api/group-members/:groupId', async (req, res) => {
    const groupId = req.params.groupId;
    const groupMetadata = await sock.groupMetadata(groupId);
    
    const members = groupMetadata.participants.map(p => {
        const name =
          sock.contacts?.[p.id]?.name ||
          sock.contacts?.[p.id]?.notify ||
          p.id.split('@')[0]; // use number as fallback
      
        return {
          id: p.id,
          name: capital(name),
        };
    });
  
    res.json(members);
});
app.get('/api/group-list/', async (req, res) => {
    let groupFetch = Object.values(await sock.groupFetchAllParticipating())
    
    const groups = groupFetch.map(p => {
        return {
          id: p.id,
          name: p.subject
        };
    });
  
    res.json(groups);
});

app.get('/api/message-list/', async (req, res) => {
    const message_list = await getMessages();
    if (message_list.length === 0) {
        return res.status(404).json({ message: "No messages found." });
    }
    const formattedMessages = message_list.map(msg => ({
        id: msg.id,
        recipient: msg.recipient,
        mentions: msg.mentions,
        type: msg.type,
        message: msg.message,
        send_time: msg.send_time,
        recurrence: msg.recurrence
    }));
    res.json(formattedMessages);
});

app.post('/api/add-message/', async (req, res) => {
    const { phone, type, msg, send_time, recurrence, mentions } = req.body;

    if (!phone || !msg || !send_time) {
        return res.status(400).json({ error: "Phone, message, and send_time are required." });
    }

    try {
        await addMessage({ phone, type, msg, send_time, recurrence, mentions });
        res.status(201).json({ message: "Message scheduled successfully." });
    } catch (error) {
        console.error("Error adding message:", error);
        res.status(500).json({ error: "Failed to schedule message." });
    }
});

connectToWhatsApp()
    .catch(err => console.log("unexpected error: " + err)) // catch any errors
server.listen(port, () => {
    console.log("Server Berjalan pada Port : " + port);
});
