// Dependencies
var express = require('express');
var router = express.Router();
var https = require('https');
var api = require('./api');
// AWS Dependencies
var AWS = require("aws-sdk");
AWS.config.update({
    region: "eu-west-1",
    endpoint: "https://dynamodb.eu-west-1.amazonaws.com"
});
var docClient = new AWS.DynamoDB.DocumentClient();


router.get('/test', function(req,res){
    res.send('settings working');
});

router.post('/updateSettings', function(req,res_body){
    // make a jawbone REST request for settings info
    var path = '/nudge/api/v.1.1/users/@me/workouts?';
    var returnJson = api.newReturnJson();

    // authenticate token
    if (!req.body.token){
        returnJson.Jawbone.message = "Token missing!";
        returnJson.Jawbone.error = true;
        return res_body.status(401).send(returnJson);
    }

    var options = {
        host: 'jawbone.com',
        path: path,
        headers: {'Authorization': 'Bearer ' + req.body.token},
        method: 'GET'
    };
    var body = "";
    var json_res = {};
    var req = https.request(options, function(res) {
        console.log('JAWBONE HTTP GET RESPONSE: ' + res.statusCode);

        res.on('data', function(d) {
            process.stdout.write(d);
            body += d;
        });
        res.on('end', function() {
            json_res = JSON.parse(body);
            if (res.statusCode != 200) {
                // REST response BAD, output error
                returnJson.Jawbone.message = JSON.stringify(json_res, null, 2);
                returnJson.Jawbone.error = true;
                return res_body.status(res.statusCode).send(returnJson);
            } else {
                json_res.data.items = api.clearEmptyItemStrings(json_res.data.items, json_res.data.size);
                for (var i = 0; i < json_res.data.size; i++) {
                    api.clearEmptyDataStrings(json_res.data.items[i].details);
                }
                returnJson.Jawbone.message = "SUCCESS";
                returnJson.Jawbone.error = false;
                putSettings();
            }
        });
        req.on('error', function(e) {
            console.error(e);
            returnJson.Jawbone.message = e.message;
            returnJson.Jawbone.error = true;
            return res_body.status(500).send(returnJson);
        });
    });
    req.end();


    // Load settings info into db
    var putSettings = function () {
        var table = "Settings";
        var user_id = json_res.meta.user_xid;

        var params = {
            TableName: table,
            Item: {
                "user_id": user_id,
                "info": json_res.data
            }
        };

        // update table
        console.log("Adding settings for user " + user_id);
        docClient.put(params, function (err, data) {
            if (err) {
                console.error("Unable to add item. Error JSON:", JSON.stringify(err, null, 2));
                returnJson.DynamoDB.message = JSON.stringify(err, null, 2);
                returnJson.DynamoDB.error = true;
                return res_body.status(500).send(returnJson);
            } else {
                console.log("item added");
                returnJson.DynamoDB.message = "SUCCESS";
                returnJson.DynamoDB.error = false;
                return res_body.status(200).send(returnJson);
            }
        });

    }

});

module.exports = router;