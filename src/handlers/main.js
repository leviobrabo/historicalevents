const { bot } = require("../bot");
const axios = require("axios");
const cheerio = require("cheerio");
const CronJob = require("cron").CronJob;
const translate = require("translate-google");

const { ChatModel, UserModel } = require("../database");

const { startCommand } = require("../commands/start");
const { histimag } = require("../commands/histimag");
const { helpCommand } = require("../commands/help");

const groupId = process.env.groupId;
function is_dev(user_id) {
    const devUsers = process.env.DEV_USERS.split(",");
    return devUsers.includes(user_id.toString());
}
bot.onText(/^\/start$/, (message) => {
    startCommand(bot, message);
});

bot.onText(/^\/photoshist/, async (message) => {
    await histimag(bot, message);
});

bot.onText(/^\/help/, (message) => {
    helpCommand(bot, message);
});

bot.onText(/^\/grupos/, async (message) => {
    const user_id = message.from.id;
    if (!(await is_dev(user_id))) {
        return;
    }
    if (message.chat.type !== "private") {
        return;
    }

    try {
        const chats = await ChatModel.find().sort({ chatId: 1 });

        let contador = 1;
        let chunkSize = 3900 - message.text.length;
        let messageChunks = [];
        let currentChunk = "";

        for (let chat of chats) {
            if (chat.chatId < 0) {
                let groupMessage = `<b>${contador}:</b> <b>Group=</b> ${chat.chatName} || <b>ID:</b> <code>${chat.chatId}</code>\n`;
                if (currentChunk.length + groupMessage.length > chunkSize) {
                    messageChunks.push(currentChunk);
                    currentChunk = "";
                }
                currentChunk += groupMessage;
                contador++;
            }
        }
        messageChunks.push(currentChunk);

        let index = 0;

        const markup = (index) => {
            return {
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: `<< ${index + 1}`,
                                callback_data: `groups:${index - 1}`,
                                disabled: index === 0,
                            },
                            {
                                text: `>> ${index + 2}`,
                                callback_data: `groups:${index + 1}`,
                                disabled: index === messageChunks.length - 1,
                            },
                        ],
                    ],
                },
                parse_mode: "HTML",
            };
        };

        await bot.sendMessage(
            message.chat.id,
            messageChunks[index],
            markup(index)
        );

        bot.on("callback_query", async (query) => {
            if (query.data.startsWith("groups:")) {
                index = Number(query.data.split(":")[1]);
                if (
                    markup(index).reply_markup &&
                    markup(index).reply_markup.inline_keyboard
                ) {
                    markup(index).reply_markup.inline_keyboard[0][0].disabled =
                        index === 0;
                    markup(index).reply_markup.inline_keyboard[0][1].disabled =
                        index === messageChunks.length - 1;
                }
                await bot.editMessageText(messageChunks[index], {
                    chat_id: query.message.chat.id,
                    message_id: query.message.message_id,
                    ...markup(index),
                });
                await bot.answerCallbackQuery(query.id);
            }
        });
    } catch (error) {
        console.error(error);
    }
});

bot.on("message", async (msg) => {
    try {
        if (
            msg.chat.type === "private" &&
            msg.entities &&
            msg.entities[0].type === "bot_command"
        ) {
            const existingUser = await UserModel.findOne({
                user_id: msg.from.id,
            });
            if (existingUser) {
                return;
            }

            const user = new UserModel({
                user_id: msg.from.id,
                username: msg.from.username,
                firstname: msg.from.first_name,
                lastname: msg.from.last_name,
            });

            await user.save();
            console.log(`User ${msg.from.id} saved in the database.`);

            const message = `#HistoricalEvents_bot #New_User
        <b>User:</b> <a href="tg://user?id=${user.user_id}">${
                user.firstname
            }</a>
        <b>ID:</b> <code>${user.user_id}</code>
        <b>Username:</b> ${user.username ? `@${user.username}` : "Uninformed"}`;
            bot.sendMessage(groupId, message, { parse_mode: "HTML" });
        }
    } catch (error) {
        console.error(
            `Error saving user ${msg.from.id} in the database: ${error.message}`
        );
    }
});

bot.on("polling_error", (error) => {
    console.error(error);
});

bot.on("new_chat_members", async (msg) => {
    const chatId = msg.chat.id;
    const chatName = msg.chat.title;

    try {
        const chat = await ChatModel.findOne({ chatId: chatId });

        if (chat) {
            console.log(
                `Group ${chatName} (${chatId}) already exists in the database`
            );
        } else if (chatId === groupId) {
            console.log(
                `The chatId ${chatId} is equal to groupId ${groupId}. It will not be saved in the database.`
            );
        } else {
            const newChat = await ChatModel.create({ chatId, chatName });
            console.log(
                `Group ${newChat.chatName} (${newChat.chatId}) added to database`
            );

            const botUser = await bot.getMe();
            const newMembers = msg.new_chat_members.filter(
                (member) => member.id === botUser.id
            );

            if (newMembers.length > 0) {
                const message = `#HistoricalEvents_bot #New_Group
            <b>Group:</b> ${chatName}
            <b>ID:</b> <code>${chatId}</code>`;

                bot.sendMessage(groupId, message, { parse_mode: "HTML" }).catch(
                    (error) => {
                        console.error(
                            `Error sending message to group ${chatId}: ${error}`
                        );
                    }
                );
            }

            bot.sendMessage(
                chatId,
                "Hello, my name is Historical Events! Thank you for adding me to your group.\n\nI will message you every day at 8 am and have some commands.",
                {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                {
                                    text: "🇧🇷 Official Channel (PT-BR)",
                                    url: "https://t.me/hoje_na_historia",
                                },
                                {
                                    text: "🇺🇸 Official Channel (EN-US)",
                                    url: "https://t.me/today_in_historys",
                                },
                            ],
                            [
                                {
                                    text: "Report bugs",
                                    url: "https://t.me/kylorensbot",
                                },
                            ],
                        ],
                    },
                }
            );
        }
        const developerMembers = msg.new_chat_members.filter(
            (member) => member.is_bot === false && is_dev(member.id)
        );

        if (developerMembers.length > 0) {
            const message = `👨‍💻 <b>ᴏɴᴇ ᴏғ ᴍʏ ᴅᴇᴠᴇʟᴏᴘᴇʀs ᴊᴏɪɴᴇᴅ ᴛʜᴇ ɢʀᴏᴜᴘ</b> <a href="tg://user?id=${developerMembers[0].id}">${developerMembers[0].first_name}</a> 😎👍`;
            bot.sendMessage(chatId, message, { parse_mode: "HTML" }).catch(
                (error) => {
                    console.error(
                        `Error sending message to group ${chatId}: ${error}`
                    );
                }
            );
        }
    } catch (err) {
        console.error(err);
    }
});

bot.on("left_chat_member", async (msg) => {
    const botUser = await bot.getMe();
    if (msg.left_chat_member.id === botUser.id && msg.chat.id === groupId) {
        console.log("Bot left the group!");

        try {
            const chatId = msg.chat.id;
            const chat = await ChatModel.findOneAndDelete({ chatId });
            console.log(
                `Group ${chat.chatName} (${chat.chatId}) removed from database`
            );
        } catch (err) {
            console.error(err);
        }
    }
});

let day, month;

async function getHistoricalEvents() {
    const today = new Date();
    day = today.getDate();
    month = today.getMonth() + 1;

    const response = await axios.get(
        `https://www.educabras.com/hoje_na_historia/buscar/${day}/${month}`
    );
    const $ = cheerio.load(response.data);
    const eventDiv = $(".nascido_neste_dia");
    let eventText = eventDiv.text().trim();

    eventText = await translate(eventText, { to: "en" });

    return eventText;
}

async function sendHistoricalEventsGroup(chatId) {
    const events = await getHistoricalEvents();
    const inlineKeyboard = {
        inline_keyboard: [
            [
                {
                    text: "📢 Official Channel",
                    url: "https://t.me/today_in_historys",
                },
            ],
        ],
    };

    if (events) {
        const message = `<b>TODAY IN HISTORY</b>\n\n📅 Event on <b>${day}/${month}</b>\n\n<i>${events}</i>`;
        const translatedMessage = await translate(message, { to: "en" });
        bot.sendMessage(chatId, translatedMessage, {
            parse_mode: "HTML",
            reply_markup: inlineKeyboard,
        });
    } else {
        const errorMessage = "<b>There are no historical events for today.</b>";
        const translatedErrorMessage = await translate(errorMessage, {
            to: "en",
        });
        bot.sendMessage(chatId, translatedErrorMessage, {
            parse_mode: "HTML",
            reply_markup: inlineKeyboard,
        });
    }
}

const morningJob = new CronJob(
    "0 8 * * *",
    async function () {
        const chatModels = await ChatModel.find({});
        for (const chatModel of chatModels) {
            const chatId = chatModel.chatId;
            if (chatId !== groupId) {
                await sendHistoricalEventsGroup(chatId);
                console.log(`Message sent successfully to group ${chatId}`);
            }
        }
    },
    null,
    true,
    "America/New_York"
);

morningJob.start();

bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.chat.id;
    const numUsers = await UserModel.countDocuments();
    const numChats = await ChatModel.countDocuments();

    const message = `\n──❑ 「 Bot Stats 」 ❑──\n\n ☆ ${numUsers} users\n ☆ ${numChats} chats`;
    bot.sendMessage(chatId, message);
});
bot.on("polling_error", (error) => {
    console.error(`Polling bot error: ${error}`);
});

function timeFormatter(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    const hoursFormatted = String(hours).padStart(2, "0");
    const minutesFormatted = String(minutes).padStart(2, "0");
    const secondsFormatted = String(secs).padStart(2, "0");

    return `${hoursFormatted}:${minutesFormatted}:${secondsFormatted}`;
}

bot.onText(/\/ping/, async (msg) => {
    const start = new Date();
    const replied = await bot.sendMessage(msg.chat.id, "𝚙𝚘𝚗𝚐!");
    const end = new Date();
    const m_s = end - start;
    const uptime = process.uptime();
    const uptime_formatted = timeFormatter(uptime);
    await bot.editMessageText(
        `𝚙𝚒𝚗𝚐: \`${m_s}𝚖𝚜\`\n𝚞𝚙𝚝𝚒𝚖𝚎: \`${uptime_formatted}\``,
        {
            chat_id: replied.chat.id,
            message_id: replied.message_id,
            parse_mode: "Markdown",
        }
    );
});

bot.onText(/^(\/broadcast|\/bc)\b/, async (msg, match) => {
    const user_id = msg.from.id;
    if (!(await is_dev(user_id))) {
        return;
    }

    const query = match.input.substring(match[0].length).trim();
    if (!query) {
        return bot.sendMessage(
            msg.chat.id,
            "<i>I need text to broadcast.</i>",
            { parse_mode: "HTML" }
        );
    }
    const sentMsg = await bot.sendMessage(msg.chat.id, "<i>Processing...</i>", {
        parse_mode: "HTML",
    });
    const web_preview = query.startsWith("-d");
    const query_ = web_preview ? query.substring(2).trim() : query;
    const ulist = await UserModel.find().lean().select("user_id");
    let sucess_br = 0;
    let no_sucess = 0;
    let block_num = 0;
    for (const { user_id } of ulist) {
        try {
            await bot.sendMessage(user_id, query_, {
                disable_web_page_preview: !web_preview,
                parse_mode: "HTML",
            });
            sucess_br += 1;
        } catch (err) {
            if (
                err.response &&
                err.response.body &&
                err.response.body.error_code === 403
            ) {
                block_num += 1;
            } else {
                no_sucess += 1;
            }
        }
    }
    await bot.editMessageText(
        `
  ╭─❑ 「 <b>Broadcast Completed</b> 」 ❑──
  │- <i>Total Users:</i> \`${ulist.length}\`
  │- <i>Successful:</i> \`${sucess_br}\`
  │- <i>Blocked:</i> \`${block_num}\`
  │- <i>Failed:</i> \`${no_sucess}\`
  ╰❑
    `,
        {
            chat_id: sentMsg.chat.id,
            message_id: sentMsg.message_id,
            parse_mode: "HTML",
        }
    );
});
bot.onText(/\/dev/, async (message) => {
    const userId = message.from.id;
    if (message.chat.type !== "private") {
        return;
    }
    const firstName = message.from.first_name;
    const message_start_dev = `Hello, <b>${firstName}</b>! You are one of the developers 🧑‍💻\n\nYou are on Janna's developer dashboard, so take responsibility and use commands with conscience`;
    const options_start_dev = {
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: {
            inline_keyboard: [
                [
                    {
                        text: "📬 Official Channel",
                        url: "https://t.me/today_in_historys",
                    },
                ],
                [
                    {
                        text: "🗃 List of commands for developerss",
                        callback_data: "commands",
                    },
                ],
            ],
        },
    };
    bot.on("callback_query", async (callbackQuery) => {
        if (callbackQuery.message.chat.type !== "private") {
            return;
        }
        const chatId = callbackQuery.message.chat.id;
        const messageId = callbackQuery.message.message_id;

        if (callbackQuery.data === "commands") {
            const commands = [
                "/stats - Statistics of groups, messages and sent users",
                "/broadcast or /bc - send message to all users",
                "/ping - see VPS latency",
                "/block - blocks a chat from receiving the message",
                "/groups - lists all groups in the db",
            ];
            await bot.editMessageText(
                "<b>List of Commands:</b> \n\n" + commands.join("\n"),
                {
                    parse_mode: "HTML",
                    disable_web_page_preview: true,
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: {
                        inline_keyboard: [
                            [
                                {
                                    text: "⬅️ Return",
                                    callback_data: "back_to_start",
                                },
                            ],
                        ],
                    },
                }
            );
        } else if (callbackQuery.data === "back_to_start") {
            await bot.editMessageText(message_start_dev, {
                parse_mode: "HTML",
                chat_id: chatId,
                message_id: messageId,
                disable_web_page_preview: true,
                reply_markup: options_start_dev.reply_markup,
            });
        }
    });
    if (is_dev(userId)) {
        bot.sendMessage(userId, message_start_dev, options_start_dev);
    } else {
        bot.sendMessage(message.chat.id, "You are not a developer");
    }
});

bot.onText(/\/block (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;

    if (msg.chat.type !== "private") {
        return bot.sendMessage(
            chatId,
            "This command can only be used in a private chat."
        );
    }

    if (!is_dev(msg.from.id)) {
        return bot.sendMessage(
            chatId,
            "You are not authorized to run this command."
        );
    }

    const chatIdToBlock = match[1];

    if (!chatIdToBlock) {
        return bot.sendMessage(
            chatId,
            "Please provide the ID of the chat you want to block."
        );
    }

    try {
        const chatModel = await ChatModel.findOne({ chatId: chatIdToBlock });
        if (!chatModel) {
            return bot.sendMessage(chatId, "Chat not found.");
        }

        chatModel.isBlocked = true;
        await chatModel.save();

        bot.sendMessage(chatId, `Chat ${chatIdToBlock} blocked successfully.`);
    } catch (error) {
        console.log(error);
        bot.sendMessage(chatId, "There was an error blocking the chat.");
    }
});

const channelStatusId = process.env.channelStatusId;

async function sendStatus() {
    const start = new Date();
    const replied = await bot.sendMessage(channelStatusId, "Bot is ON");
    const end = new Date();
    const m_s = end - start;
    const uptime = process.uptime();
    const uptime_formatted = timeFormatter(uptime);
    const numUsers = await UserModel.countDocuments();
    const numChats = await ChatModel.countDocuments();
    await bot.editMessageText(
        `#HistoricalEvents_bot #Status\n\nStatus: ON\nPing: \`${m_s}ms\`\nUptime: \`${uptime_formatted}\`\nUsers: \`${numUsers}\`\nChats: \`${numChats}\``,
        {
            chat_id: replied.chat.id,
            message_id: replied.message_id,
            parse_mode: "Markdown",
        }
    );
}

function timeFormatter(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    const hoursFormatted = String(hours).padStart(2, "0");
    const minutesFormatted = String(minutes).padStart(2, "0");
    const secondsFormatted = String(secs).padStart(2, "0");

    return `${hoursFormatted}:${minutesFormatted}:${secondsFormatted}`;
}

const job = new CronJob(
    "03 00 12 * * *",
    sendStatus,
    null,
    true,
    "America/Sao_Paulo"
);

const channelId = process.env.channelId;

async function getHistoricalEventsEn() {
    const today = new Date();
    day = today.getDate();
    month = today.getMonth() + 1;

    const response = await axios.get(
        `https://www.educabras.com/hoje_na_historia/buscar/${day}/${month}`
    );
    const $ = cheerio.load(response.data);
    const eventDiv = $(".nascido_neste_dia");
    let eventText = eventDiv.text().trim();

    eventText = await translate(eventText, { to: "en" });

    return eventText;
}

async function sendHistoricalEventsChannel(channelId) {
    const events = await getHistoricalEventsEn();
    if (events) {
        const message = `<b>TODAY IN HISTORY</b>\n\n📅 Event on <b>${day}/${month}</b>\n\n<i>${events}</i>`;
        const translatedMessage = await translate(message, { to: "en" });
        bot.sendMessage(channelId, translatedMessage, {
            parse_mode: "HTML",
        });
    } else {
        const errorMessage = "<b>There are no historical events for today.</b>";
        const translatedErrorMessage = await translate(errorMessage, {
            to: "en",
        });
        bot.sendMessage(channelId, translatedErrorMessage, {
            parse_mode: "HTML",
        });
    }
}

const channelEnJob = new CronJob(
    "47 9 * * *",
    function () {
        sendHistoricalEventsChannel(channelId);
        console.log(`Message successfully sent to the channel ${channelId}`);
    },
    null,
    true,
    "America/New_York"
);

channelEnJob.start();

exports.initHandler = () => {
    return bot;
};
