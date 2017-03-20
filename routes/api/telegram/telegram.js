// Dependencies
let express = require('express');
let router = express.Router();
let https = require('https');
let request = require('request');
let loggerModule = require('../../logger');
var api = require('../jawbone/api');
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



    if (json.hasOwnProperty('callback_query')) {
        callbackID = json.callback_query.id;
        chat_id = json.callback_query.message.chat.id;

        // handle message ID
        msgID = getMsgID(chat_id);
        if (msgID == 0) {
            setMsgID(chat_id, json.callback_query.message.message_id);
        } else if (json.callback_query.message.message_id <= msgID) {
            // avoid duplicate messages
            logger.info("duplicate response detected");
            callbackQuery("I've already replied to that");
            return;
        } else {
            setMsgID(chat_id, json.callback_query.message.message_id);
        }
    }


    if (json.hasOwnProperty('message')) {
        chat_id = json.message.chat.id;
        // handle message ID
        msgID = getMsgID(chat_id);
        if (msgID == 0) {
            setMsgID(chat_id, json.message.message_id);
        } else if (json.message.message_id <= msgID) {
            // avoid duplicate messages
            callbackMessage(chat_id, "I've already replied to that");
        } else {
            setMsgID(chat_id, json.message.message_id);
            msgID = json.message.message_id
        }

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
                        logger.info("The users mood has been added to their sleep!");
                        return callback("Your mood has been added");
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
            logger.error("putSleepSummary() : Unable to read User item. Error JSON:", JSON.stringify(err, null, 2));
            return callback("error finding User for putSleepSummary");
        } else {
            userID = user;
            let dateString = date.getFullYear() + "/" + api.pad(date.getMonth(), 2).toString() + "/"
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
                    logger.info("The users mood has been added to their sleep!");
                    return callback("Your mood has been added");
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
            userID = user.Items[0].user_id;
            return callback(userID);
        }
    });
}



function getMsgID(chat_id) {
    let id = 0;
    // handle message ID
    if (IDs.hasOwnProperty(chat_id)) {
        id = IDs[chat_id];
    } else {
        IDs[chat_id] = 0;
    }
    return id;
}

function setMsgID(chat_id, id) {
    IDs[chat_id] = id;
}

module.exports = router;