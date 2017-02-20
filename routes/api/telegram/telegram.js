// Dependencies
var express = require('express');
var router = express.Router();
var https = require('https');
var request = require('request');
var loggerModule = require('../../logger');
// AWS Dependencies
var AWS = require('aws-sdk');
AWS.config.update({
    region: "eu-west-1",
    endpoint: "https://dynamodb.eu-west-1.amazonaws.com"
});
var docClient = new AWS.DynamoDB.DocumentClient();
var logger = loggerModule.getLogger();
var botAPI = "378664495:AAGebJUO0FdqwdhpATtf-QP0cEEloH7TGNk";

router.post('/new-message', function(req,res_body) {
    const {message} = req.body;

    if (!message) {
        return res_body.status(400).send("");
    }
    logger.info("chat_id: " + message.chat.id);
    // reply
    request({
        url: 'https://api.telegram.org/bot' + botAPI + '/' + 'sendMessage',
        method: "POST",
        json: {
            "chat_id": message.chat.id,
            "text": "replied"
        },
        headers: { "content-type" : "application/json"}
    }, function(err, res, body){
        if(err) {logger.error('problem with request: ' + e.message);}
        return res_body.status(res.statusCode).send(body);
    });


});

module.exports = router;