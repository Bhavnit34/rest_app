// Dependencies
let express = require('express');
let router = express.Router();
let https = require('https');
let request = require('request');
let loggerModule = require('../../logger');
// AWS Dependencies
let AWS = require('aws-sdk');
AWS.config.update({
    region: "eu-west-1",
    endpoint: "https://dynamodb.eu-west-1.amazonaws.com"
});
const docClient = new AWS.DynamoDB.DocumentClient();
const logger = loggerModule.getLogger();
const botAPI = "378664495:AAGebJUO0FdqwdhpATtf-QP0cEEloH7TGNk";

router.post('/new-message', function(req,res_body) {
    let json = req.body;
    console.log(JSON.stringify(json,null, 2));
    const callbackID = json.callback_query.id;

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
            logger.info("responded successfully");
        });
    };

    // handle function for a message reply
    let callback_data = null;
    if (json.callback_query.data) {
        callback_data = json.callback_query.data;
        if (callback_data.caller = "updateSleeps") {
            putSleepSummary(json, callback_data, function(msg) {
                callbackQuery(msg);
            });
        } else {
            callbackQuery("success");
        }
    }








    /* reply
    request({
        url: 'https://api.telegram.org/bot' + botAPI + '/' + 'sendMessage',
        method: "POST",
        json: {
            "chat_id": json.callback_query.message.chat.id,
            "text": "replied"
        },
        headers: { "content-type" : "application/json"}
    }, function(err, res, body){
        if(err) {logger.error('problem with request: ' + e.message);}
        return res_body.status(res.statusCode).send(body);
    });
    */
    

});

function putSleepSummary(json, callback_data, callback) {
    let userID = "";
    let timestamp  = 0;
    const params = {
        TableName : "User",
        KeyConditionExpression: "chat_id = :chat_id",
        ExpressionAttributeValues: {":chat_id" : json.chat_id},
        Limit: 1
    };

    // Find the userID, given the chat_id
    docClient.query(params, function (err, user) {
        if (err) {
            logger.error("putSleepSummary() : Unable to read User item. Error JSON:", JSON.stringify(err, null, 2));
        } else {
            userID = user.Item.user_id;

            const params = {
                TableName : "Sleeps",
                KeyConditionExpression : "user_id = :user_id AND #date = :date",
                ExpressionAttributeValues : {
                    ":user_id" : userID,
                    ":date" : callback_data.date
                },
                ExpressionAttributeNames: { '#date' : date },
                Limit: 1
            };

            // find the sleep, given the data. This gives us the timestamp_completed to make up the rows key
            docClient.query(params, function (err, data) {
                if (err) {
                    logger.error("putSleepSummary() : Unable to read Sleep item. Error JSON:", JSON.stringify(err, null, 2));
                }
                timestamp = data.Item.timestamp_completed;

                const params = {
                    TableName : "Sleeps",
                    Key: {"user_id": user_id, "timestamp_completed" : timestamp},
                    UpdateExpression: "set mood = :mood",
                    ExpressionAttributeValues: {":mood" : callback_data.mood},
                    ReturnValues: "UPDATED_NEW" // give the resulting updated fields as the JSON result
                };

                // Update the Sleep row to include the mood
                docClient.update(params, function (err, data) {
                    if (err) {
                        logger.error("Error updating Stats Sleep table. Error JSON:", JSON.stringify(err, null, 2));
                    } else {
                        logger.info("The users mood has been added to their sleep!");
                        return callback("Your mood has been added");
                    }
                });

            });


        }
    });
}

module.exports = router;