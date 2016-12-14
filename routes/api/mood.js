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
    res.send('mood working');
});

router.post('/updateMood', function(req,res_body){
    // make a jawbone REST request for mood info
    if (!req.body.token.toString().trim()){
        return res_body.json({
            message: "Token missing!",
            error: true
        })
    }
    var options = {
        host: 'jawbone.com',
        path: '/nudge/api/v.1.1/users/@me/mood',
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
            json_res.data = api.clearEmptyDataStrings(json_res.data);
            res_body.send(JSON.stringify(json_res, null, 4));
            putMoodEvents();


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


    // Load user info into db
    var putMoodEvents = function () {
        var table = "Mood";
        var user_id = json_res.meta.user_xid;
        var date = json_res.data.date.toString();

        var params = {
            TableName: table,
            Item: {
                "user_id": user_id,
                "timestamp": json_res.data.time_created,
                "date": date.substr(0,4) + "/" + date.substr(4,2) + "/" + date.substr(6,2),
                "info": json_res.data
            }
        };

        // update table
        console.log("Adding mood " +  date + " for user " + user_id);
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