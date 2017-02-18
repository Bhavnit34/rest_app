// Dependencies
var express = require('express');
var router = express.Router();
var https = require('https');
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
    var message = client_req.body;

    if (!message) {
        return res_body.status(400).send("");
    }

    // reply
    var options = {
        hostname: 'https://api.telegram.org/bot' + botAPI,
        path: '/sendMessage',
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        json: {
            "chat_id": message.chat_id,
            "text": "replied"
        }
    };

    var client_req = https.request(options, function(res) {
        console.log('Status: ' + res.statusCode);
        console.log('Headers: ' + JSON.stringify(res.headers));
        res.setEncoding('utf8');
        res.on('data', function (body) {
            console.log('Body: ' + body);
        });
    });
    client_req.on('error', function(e) {
        console.log('problem with request: ' + e.message);
    });
    client_req.end();


});