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
    const {message} = req.body;
    let json = req.body;
    console.log(JSON.stringify(json,null, 2));
    let callbackID = json.callback_query.id;



    if (!message) {
        // return res_body.status(400).send("");
    } else {
        console.log(JSON.stringify(message));
    }


    request({
        url: 'https://api.telegram.org/bot' + botAPI + '/' + 'answerCallbackQuery',
        method: "POST",
        json: {
            "callback_query_id": callbackID,
            "text" : "success"
        },
        headers: { "content-type" : "application/json"}
    }, function(err, res, body){
        if(err) {logger.error('problem with request: ' + e.message);}
        console.log("answered successfully");
    });

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

module.exports = router;