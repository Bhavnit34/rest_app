// Dependencies
let express = require('express');
let router = express.Router();
let https = require('https');
let request = require('request');
let loggerModule = require('../../logger');
let api = require('../api');
let fs = require('fs');
// AWS Dependencies
let AWS = require('aws-sdk');
AWS.config.update({
    region: "eu-west-1",
    endpoint: "https://dynamodb.eu-west-1.amazonaws.com"
});
const docClient = new AWS.DynamoDB.DocumentClient();
const logger = loggerModule.getLogger();
const botAPI = "378664495:AAGebJUO0FdqwdhpATtf-QP0cEEloH7TGNk";
let emojis = ["\uD83D\uDE01", "\uD83D\uDE0A", "\uD83D\uDE0C","\uD83D\uDE14","\uD83D\uDE2B"];
let IDs = {};

// read in the stored json of handled IDs
readIDsFromFile();

router.post('/new-message', function(req,res_body) {
    let json = req.body;
    logger.info("json: " + JSON.stringify(json,null, 4));
    let callbackID = null;
    let chat_id = null;

    let callbackQuery = function (msg) {
        request({
            url: 'https://api.telegram.org/bot' + botAPI + '/' + 'answerCallbackQuery',
            method: "POST",
            json: {
                "callback_query_id": callbackID,
                "text" : msg
            },
            headers: { "content-type" : "application/json"}
        }, function(err, res, body){
            if(err) {logger.error('problem with request: ' + err.message);}
            return res_body.status(200).send("responded successfully");
        });
    };

    let callbackMessage = function (chat_id, msg) {
        request({
            url: 'https://api.telegram.org/bot' + botAPI + '/' + 'sendMessage',
            method: "POST",
            json: {
                "chat_id": chat_id,
                "text": msg
            },
            headers: { "content-type" : "application/json"}
        }, function(err, res, body){
            if(err) {logger.error('problem with request: ' + e.message);}
            return res_body.status(200).send();
        });
    };


    // check if message requires a callback
    if (json.hasOwnProperty('callback_query')) {
        callbackID = json.callback_query.id;
        chat_id = json.callback_query.message.chat.id;

        // handle message ID
        if (msgIDExists(chat_id, json.callback_query.message.message_id)) {
            // avoid duplicate messages
            logger.info("duplicate response detected");
            callbackQuery("I've already replied to that");
            return;
        }
    }

    // check if message was a standalone user message
    if (json.hasOwnProperty('message')) {
        let msg = "";
        let chat_id = json.message.chat.id;

        // check if the message was a reply
        if (json.message.hasOwnProperty('reply_to_message')) {
            // ensure we haven't handled this
            if (msgIDExists(chat_id, json.message.reply_to_message.message_id)) {
                // avoid duplicate messages
                msg = "You've already replied to that message";
                logger.info("response to handled message detected");
            }
        }

        if(json.message.hasOwnProperty("text")) {
            let text = json.message.text;
            text = text.toLowerCase();
            if (text.indexOf("average") > -1) {
                sendWeeklyStats(json);
            } else {
                msg = "Nothing to do.";
            }
        }
        callbackMessage(chat_id, msg);
        return;

    }

    // handle function for a message reply
    let callback_data = null;
    if (callbackID) {
        callback_data = JSON.parse(json.callback_query.data);
        const caller = callback_data.caller.toString();
        switch (caller) {
            case "updateSleeps": {
                putSleepSummary(json, callback_data, function(msg) {
                    callbackQuery(msg);
                });
                break;
            }
            case "updateMoves": {
                logger.info("calling putDaySummary...");
                putDaySummary(json, callback_data, function(msg) {
                    callbackQuery(msg);

                });
                break;
            }
            case "wo": {
                logger.info("calling putWorkoutSummary...");
                putWorkoutSummary(json, callback_data, function(msg) {
                    callbackQuery(msg);

                });
                break;
            }
            default : callbackQuery("nothing to do");
        }
    } else {
        callbackMessage(chat_id, "nothing to do");
    }

});

// function to send a message to the user
let sendTelegramMessage = function(json, callback){
        request({
            url: 'https://api.telegram.org/bot' + botAPI + '/' + 'sendMessage',
            method: "POST",
            json: json,
            headers: {"content-type": "application/json"}
        }, function (err, res, body) {
            let msg = "";
            if (err) {
                msg = 'telegramRequest() :  problem with request: ' + err.message;
                logger.error(msg);
                return callback(true, msg);
            }
            msg = "A telegram message has been sent to the user";
            logger.info("telegramRequest() : " + msg);
            return callback(false, msg);
        });
};

// function to store the users response to their sleep
function putSleepSummary(json, callback_data, callback) {
    let userID = "";
    let timestamp  = 0;
    let date  = new Date(json.callback_query.message.date * 1000);
    // Find the userID, given the chat_id
    getUserID(json.callback_query.message.chat.id, function (user) {
        if (!user) {
            logger.error("putSleepSummary() : Unable to read User item.");
            return callback("error finding User for putSleepSummary");
        } else {
            userID = user;
            let dateString = date.getFullYear() + "/" + api.pad(date.getMonth()+1, 2).toString() + "/"
                + api.pad(date.getDate(),2);

            const params = {
                TableName : "Sleeps",
                FilterExpression : "user_id = :user_id AND #date = :date",
                ExpressionAttributeValues : {
                    ":user_id" : userID,
                    ":date" : dateString
                },
                ExpressionAttributeNames: { '#date' : 'date' }
            };

            // find the sleep, given the data. This gives us the timestamp_completed to make up the rows key
            docClient.scan(params, function (err, data) {
                if (err) {
                    logger.error("putSleepSummary() : Unable to read Sleep item. Error JSON:", JSON.stringify(err, null, 2));
                    return callback("error finding Sleep for putSleepSummary");
                }
                timestamp = data.Items[0].timestamp_completed;

                const params = {
                    TableName : "Sleeps",
                    Key: {"user_id": userID, "timestamp_completed" : timestamp},
                    UpdateExpression: "set mood = :mood",
                    ExpressionAttributeValues: {":mood" : callback_data.mood},
                    ReturnValues: "UPDATED_NEW" // give the resulting updated fields as the JSON result
                };

                // Update the Sleep row to include the mood
                docClient.update(params, function (err, data) {
                    if (err) {
                        logger.error("Error updating mood for Sleep table. Error JSON:", JSON.stringify(err, null, 2));
                        return callback("error updating mood for Sleep for putSleepSummary");
                    } else {
                        // now mark the message in the chat as answered, giving their answer
                        const answers = ["Very tired " + emojis[4], "Somewhat tired " + emojis[3],
                            "OK " + emojis[2], "Good " + emojis[1], "Refreshed " + emojis[0]];
                        let answer = answers[callback_data.mood - 1]; // -1 as mood starts from 1


                        editMessageAsAnswered(json, answer, function(error, msg) {
                            if (error) {
                                logger.error(msg);
                                return callback(msg);
                            }
                            logger.info("The users mood has been added to their day!");
                            return callback("Your sleep feedback has been logged");
                        });
                    }
                });

            });


        }
    });
}

// function to store the users response to their day
function putDaySummary(json, callback_data, callback) {
    let userID = "";
    let date  = new Date(callback_data.timestamp * 1000);
    // Find the userID, given the chat_id
    getUserID(json.callback_query.message.chat.id, function (user) {
        if (!user) {
            logger.error("putSleepSummary() : Unable to read User item.");
            return callback("error finding User for putSleepSummary");
        } else {
            userID = user;
            let dateString = date.getFullYear() + "/" + api.pad(date.getMonth()+1, 2).toString() + "/"
                + api.pad(date.getDate(),2);
            let timestamp = parseInt(date.getTime().toString().substr(0,10));
            const params = {
                TableName : "DailyMood",
                Key: {"user_id": userID, "timestamp_completed" : timestamp},
                UpdateExpression: "set mood = :mood, #date = :date",
                ExpressionAttributeValues: {":mood" : callback_data.mood, ":date": dateString},
                ExpressionAttributeNames: {"#date" : "date"},
                ReturnValues: "UPDATED_NEW" // give the resulting updated fields as the JSON result
            };


            // Update the DailyMood row to include the mood
            docClient.update(params, function (err, data) {
                if (err) {
                    logger.error("Error updating DailyMood table. Error JSON:", JSON.stringify(err, null, 2));
                    return callback("error updating mood for putDaySummary");
                } else {
                    // now mark the message in the chat as answered, giving their answer
                    const answers = [emojis[4], emojis[3], emojis[2],emojis[1], emojis[0]];
                    let answer = answers[callback_data.mood - 1]; // -1 as mood starts from 1


                    editMessageAsAnswered(json, answer, function(error, msg) {
                    if (error) {
                        logger.error(msg);
                        return callback(msg);
                    }
                    logger.info("The users mood has been added to their day!");
                    return callback("Your mood for the day has been logged");
                    });
                }
            });



        }
    });
}

// function to store the users response to their workout
function putWorkoutSummary(json, callback_data, callback) {
    let userID = "";
    let finished_timestamp = parseInt(callback_data.timestamp);
    let msg = "";
    // Find the userID, given the chat_id
    getUserID(json.callback_query.message.chat.id, function (user) {
        if (!user) {
            logger.error("putWorkoutSummary() : Unable to read User item.");
            return callback("error finding User for putWorkoutSummary");
        } else {
            userID = user;
            const params = {
                TableName : "Workouts",
                Key: {"user_id": userID, "timestamp_completed" : finished_timestamp},
                UpdateExpression: "set mood = :mood",
                ExpressionAttributeValues: {":mood" : callback_data.mood},
                ReturnValues: "UPDATED_NEW" // give the resulting updated fields as the JSON result
            };

            // Update the Workout row to include the mood
            docClient.update(params, function (err, data) {
                if (err) {
                    msg = "Error updating mood for Workouts table. Error JSON:" +  JSON.stringify(err, null, 2);
                    logger.error(msg);
                    return callback("Error updating mood in the table");
                } else {
                    // now mark the message in the chat as answered, giving their answer
                    const answers = ["Falling asleep " + emojis[4], "Somewhat tired " + emojis[3],
                        "Holding up OK " + emojis[2], "Good " + emojis[1], "Energised " + emojis[0]];
                    let answer = answers[callback_data.mood - 1]; // -1 as mood starts from 1


                    editMessageAsAnswered(json, answer, function(error, msg) {
                        if (error) {
                            logger.error(msg);
                            return callback(msg);
                        }
                        logger.info("The users mood has been added to their workout!");
                        return callback("Your workout feedback has been logged");
                    });
                }
            });

        }
    });
}

// function to send the user their requested weekly stats values
function sendWeeklyStats(json) {
    let userID = "";
    let msg = "";
    // Find the userID, given the chat_id
    getUserID(json.message.chat.id, function (user) {
        if (!user) {
            logger.error("sendWeeklyStats() : Unable to read User item.");
            return callback("error finding User for sendWeeklyStats()");
        } else {
            userID = user;
            // get the timestamp of the latest Sunday
            let sunday = new Date();
            sunday.setHours(0,0,0,0);
            while (sunday.getDay() !== 0) { // 0 = Sunday
                sunday = new Date(sunday.getTime() - 86400000); // i.e. minus one day
                if (sunday.getHours() === 23) {
                    sunday = new Date(sunday.getTime() + 3600000); // add 1 hour if it goes into DST
                }
            }
            // the 10 digit timestamp of the sunday
            let date = parseInt(sunday.getTime().toString().substr(0,10));
            // the date to be read in the logs
            let dateString = sunday.toString().split(" ").slice(0,4).join(" ");


            let params = {
                TableName : "WeeklyStats",
                KeyConditionExpression: "user_id = :user_id AND timestamp_weekStart = :timestamp",
                ExpressionAttributeValues : {":user_id" : userID, ":timestamp" : date},
                Limit: 1
            };

            // Get the latest weekly stats info from the DB
            docClient.query(params, function (err, data) {
                if (err) {
                    msg = "sendWeeklyStats() : Error reading WeeklyStats for Workouts table. Error JSON:" +  JSON.stringify(err, null, 2);
                    logger.error(msg);
                    return;
                } else {
                    if (data.Count === 0) {
                        logger.info("sendWeeklyStats() : this user has no recent weekly stats data");
                        let jsonMessage = {
                            "chat_id" : json.message.chat.id,
                            "text" : "We don't have any information to give you about this week.",
                        };
                        sendTelegramMessage(jsonMessage, function(err, message){
                        if (err) {
                            msg = "sendWeeklyStats() : error sending Telegram message. " + message;
                            logger.error(msg);
                            return;
                        }
                        })
                        return;
                    }

                    // take in some important weekly stats information
                    let stats = data.Items[0].info;
                    let HR = stats.HeartRate.avg;
                    // moves
                    let calories = stats.Moves.Calories.avg;
                    let steps = stats.Moves.Steps.avg;
                    // sleeps
                    let sleep_duration = calculateTime(stats.Sleep.Duration.avg);
                    let deep = calculateTime(stats.Sleep.Deep.avg);
                    let REM = calculateTime(stats.Sleep.REM.avg);
                    let light = calculateTime(stats.Sleep.Light.avg);
                    // workouts
                    let wo_count = stats.Workouts.Count.count;
                    let wo_calories = stats.Workouts.Calories.avg;

                    // present this in human-friendly form
                    let text = "Some of your important *averages* for week beginning " + dateString + ":\n\n " +
                        "HR : " + HR + "\n " +
                        "Cal. Burned : " + calories + "\n " +
                        "Steps : " + steps + "\n " +
                        "Hours Slept : " + sleep_duration + "\n " +
                        "Deep Sleep : " + deep + "\n " +
                        "REM Sleep : " + REM + "\n " +
                        "Light Sleep : " + light + "\n " +
                        "Total Workouts completed : " + wo_count + "\n " +
                        "Cal. Burned During Workouts : " + wo_calories;

                    logger.info(text);


                    let chat_id = json.message.chat.id;
                    let jsonMessage = {
                        "chat_id" : chat_id,
                        "text" : text,
                        "parse_mode" : "Markdown"
                    };

                    // send this message to the user
                    sendTelegramMessage(jsonMessage, function(err, message) {
                        if (err) {
                            msg = "sendWeeklyStats() : error sending Telegram message. " + message;
                            logger.error(msg);
                            return;
                        }
                    })


                }
            });

        }
    });
}

// function to return seconds into hours and minutes
function calculateTime(seconds) {
    let hours = Math.floor(seconds / 3600);
    let mins = Math.round((seconds - (hours * 3600)) / 60);
    return (hours + "h " + mins + "m");
}


// function to return the UserID, given the chatID
function getUserID(chat_id, callback) {
    let userID = null;
    const params = {
        TableName : "User",
        FilterExpression: "chat_id = :chat_id",
        ExpressionAttributeValues: {":chat_id" : chat_id}
    };

    // Find the userID, given the chat_id
    docClient.scan(params, function (err, user) {
        if (err) {
            logger.error("putSleepSummary() : Unable to read User item. Error JSON:", JSON.stringify(err, null, 2));
            return callback(userID);
        } else {
            if (user.Count < 1) {
                return callback(null);
            }
            userID = user.Items[0].user_id;
            return callback(userID);
        }
    });
}


// function to handle the msgID of each chat, to ensure we don't get duplicate responses
function msgIDExists(chat_id, id) {
    if (IDs.hasOwnProperty(chat_id)) {
        if (IDs[chat_id].indexOf(id) > -1) {
            return true;
        } else {
            IDs[chat_id].push(id);
            return false;
        }
    } else {
        IDs[chat_id] = [id];
        return false;
    }
}

// function to edit a sent msg to display their answer and restrict replying
function editMessageAsAnswered(json_whole, answer, callback) {
    if (answer === null) {
        logger.info("editMessageAsAnswered() : Answer was undefined. Skipping editting msg");
        return callback(false, null)
    }

    let json = {};
    if (json_whole.hasOwnProperty('callback_query')) {
        json = json_whole.callback_query
    } else if (!json_whole.hasOwnProperty('message')) {
        // we don't understand the JSON
        return callback(true, "editMessageAsAnswered() : Unknown json given, " + JSON.stringify(json_whole,null,4));
    }
    let chat_id = json.message.chat.id;
    let msg_id = json.message.message_id;
    let orig_text = json.message.text;


    request({
        url: 'https://api.telegram.org/bot' + botAPI + '/' + 'editMessageText',
        method: "POST",
        json: {
            "chat_id": chat_id,
            "message_id": msg_id,
            "text": orig_text + "\nYou answered : " + answer
        },
        headers: { "content-type" : "application/json"}
    }, function(err, res, body){
        if(err) {
            const msg = 'problem with request: ' + e.message;
            logger.error(msg);
            return callback(true, msg);
        }
        return callback(false, null)
    });
}

// function to read the handled messages from a local file
function readIDsFromFile() {
    fs.readFile('./IDs.json', 'utf8', function(err, data) {
        if (err) {
            logger.info("readIDsFromFile() : could not read JSON file. IDs is therefore currently empty");
            return;
        }
        logger.info("ID DATA: " + data);
        IDs = JSON.parse(data);
    });
}

// function to store the IDs handled to
function writeIDsToFile() {
    logger.info("IDs to write: " + JSON.stringify(IDs));
    fs.writeFileSync('./IDs.json', JSON.stringify(IDs));
}


// Handle cleanup
process.stdin.resume();

function exitHandler(options, err) {
    if (options.cleanup) {
        logger.info("Writing IDs to file before exiting...");
        writeIDsToFile();
    }
    if (err) console.log(err.stack);
    if (options.exit) process.exit();
}

// when app is about to close
process.on('exit', exitHandler.bind(null,{cleanup:true}));

// handles ctrl+c event
process.on('SIGINT', exitHandler.bind(null, {exit:true}));

process.on('SIGTERM', exitHandler.bind(null, {exit:true}));

//handles uncaught exceptions
process.on('uncaughtException', exitHandler.bind(null, {exit:true}));

module.exports = router;
module.exports.sendTelegramMessage = sendTelegramMessage; // allows the function to be called from other modules