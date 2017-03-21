// Dependencies
let express = require('express');
let router = express.Router();
let https = require('https');
let request = require('request');
let loggerModule = require('../../logger');
var api = require('../jawbone/api');
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
let msgID = 0;
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
        chat_id = json.message.chat.id;

        // check if the message was a reply
        if (json.message.hasOwnProperty('reply_to_message')) {
            // ensure we haven't handled this
            if (msgIDExists(chat_id, json.message.reply_to_message.message_id)) {
                // avoid duplicate messages
                msg = "You've already replied to that message";
                logger.info("response to handled message detected");
            }
        }
        // handle message ID
        if (msgIDExists(chat_id, json.message.message_id)) {
            // avoid duplicate messages
            logger.info("duplicate response detected");
            msg = "I've already replied to that";
           
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
                    logger.info("replying from putSleepSummary");
                    callbackQuery(msg);
                });
                break;
            }
            case "updateMoves": {
                logger.info("calling putDaySummary...")
                putDaySummary(json, callback_data, function(msg) {
                    logger.info("replying from putDaySummary");
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

function putSleepSummary(json, callback_data, callback) {
    let userID = "";
    let timestamp  = 0;
    // Find the userID, given the chat_id
    getUserID(json.callback_query.message.chat.id, function (user) {
        if (!user) {
            logger.error("putSleepSummary() : Unable to read User item. Error JSON:", JSON.stringify(err, null, 2));
            return callback("error finding User for putSleepSummary");
        } else {
            userID = user;

            const params = {
                TableName : "Sleeps",
                FilterExpression : "user_id = :user_id AND #date = :date",
                ExpressionAttributeValues : {
                    ":user_id" : userID,
                    ":date" : callback_data.date
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
                        let answer = null;
                        // decode the emoji to display correctly on the msg
                        if (callback_data.hasOwnProperty('answer')) {
                            answer = decodeURIComponent(escape(callback_data.answer));
                        }

                        editMessageAsAnswered(json, answer, function(error, msg) {
                            if (error) {
                                logger.error(msg);
                                return callback(msg);
                            }
                            logger.info("The users mood has been added to their day!");
                            return callback("Your mood for the day has been added");
                        });
                    }
                });

            });


        }
    });
}


function putDaySummary(json, callback_data, callback) {
    let userID = "";
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
                TableName : "DailyMood",
                Key: {"user_id": userID, "date" : dateString},
                UpdateExpression: "set mood = :mood",
                ExpressionAttributeValues: {":mood" : callback_data.mood},
                ReturnValues: "UPDATED_NEW" // give the resulting updated fields as the JSON result
            };


            // Update the Sleep row to include the mood
            docClient.update(params, function (err, data) {
                if (err) {
                    logger.error("Error updating DailyMood table. Error JSON:", JSON.stringify(err, null, 2));
                    return callback("error updating Sleep for putSleepSummary");
                } else {
                    // now mark the message in the chat as answered, giving their answer
                    let answer = null;
                    // decode the emoji to display correctly on the msg
                    if (callback_data.hasOwnProperty('answer')) {
                        answer = decodeURIComponent(escape(callback_data.answer));
                    }
                    editMessageAsAnswered(json, answer, function(error, msg) {
                    if (error) {
                        logger.error(msg);
                        return callback(msg);
                    }
                    logger.info("The users mood has been added to their day!");
                    return callback("Your mood for the day has been added");
                    });
                }
            });



        }
    });
}



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
            logger.info(JSON.stringify(user, null, 4));
            if (user.Count < 1) {
                return callback(null);
            }
            userID = user.Items[0].user_id;
            return callback(userID);
        }
    });
}



function msgIDExists(chat_id, id) {
    // handle message ID
    if (IDs.hasOwnProperty(chat_id)) {
        if (IDs[chat_id].indexOf(id) > -1) {
            return true;
        } else {
            IDs[chat_id].push(id);
            logger.info(JSON.stringify(IDs, null, 2));
            return false;
        }
    } else {
        IDs[chat_id] = [id];
        return false;
    }
}

function editMessageAsAnswered(json_whole, answer, callback) {
    if (answer == null) {
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
            "text": orig_text + " (You answered : " + answer + " )"
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
        };
        IDs = JSON.parse(data);
    });
}

// function to store the IDs handled to
function writeIDsToFile() {
    logger.info(JSON.stringify(IDs));
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

//handles uncaught exceptions
process.on('uncaughtException', exitHandler.bind(null, {exit:true}));


module.exports = router;