// Dependencies
var express = require('express');
var router = express.Router();
var https = require('https');
// AWS Dependencies
var AWS = require("aws-sdk");
AWS.config.update({
    region: "eu-west-1",
    endpoint: "https://dynamodb.eu-west-1.amazonaws.com"
});
var docClient = new AWS.DynamoDB.DocumentClient();

// routes
router.get('/test', function(req,res){
    res.send('user working');
});

router.post('/addUser', function(req,res_body){
    // make a jawbone REST request for user info
    if (!req.body.token.toString().trim()){
        return res_body.json({
            message: "Token missing!",
            error: true
        })
    }
    var options = {
        host: 'jawbone.com',
        path: '/nudge/api/v.1.1/users/@me',
        headers: {'Authorization': 'Bearer ' + req.body.token},
        method: 'GET'
    }
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
            loadUserInfo();
        })
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
    var loadUserInfo = function () {
        var table = "User";
        var user_id = json_res.data.xid;
        json_res.data.image = "none";
        var params = {
            TableName: table,
            Item: {
                "user_id": user_id,
                "info": json_res.data
            }
        };


        console.log("Adding a new item...");
        docClient.put(params, function (err, data) {
            if (err) {
                console.error("Unable to add item. Error JSON:", JSON.stringify(err, null, 2));
            } else {
                console.log("Added item:", JSON.stringify(data, null, 2));
            }
        });
    }

});



//return router
module.exports = router;