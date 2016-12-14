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
    if (!req.body.token){
        return res_body.json({
            message: "Token missing!",
            error: true
        })
    }
    var options = {
        host: 'jawbone.com',
        path: '/nudge/api/v.1.1/users/@me/settings',
        headers: {'Authorization': 'Bearer ' + req.body.token},
        method: 'GET'
    };
    var body = "";
    var json_res = {};
    var req = https.request(options, function(res) {
        console.log('HTTP GET RESPONSE: ' + res.statusCode);

        res.on('data', function(d) {
            process.stdout.write(d);
            body += d;
        });
        res.on('end', function() {
            json_res = JSON.parse(body);
            res_body.send(JSON.stringify(json_res, null, 4));
            putSettings();


        });
        req.on('error', function(e) {
            console.error(e);
            return res_body.json({
                message: e.message,
                error: true
            })
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
            } else {
                console.log("item added");
            }
        });

    }

});

module.exports = router;