#!/usr/bin/env node

let request = require('request');
let nforce = require('nforce');
let faye = require('faye');
let AWS = require('aws-sdk');
AWS.config.update({region:'us-east-1'});
let lambda = new AWS.Lambda();

let AMZ_CLIENT_ID = process.env.AMZ_CLIENT_ID;
let AMZ_CLIENT_SECRET = process.env.AMZ_CLIENT_SECRET;
let AMZ_REDIRECT_URI = 'http://localhost:3000/openid/callback';

let SF_CLIENT_ID = process.env.SF_CLIENT_ID;
let SF_CLIENT_SECRET = process.env.SF_CLIENT_SECRET;
let SF_USER_NAME = process.env.SF_USER_NAME;
let SF_USER_PASSWORD = process.env.SF_USER_PASSWORD;

let DISPATCH_LOCAL = false;

let org = nforce.createConnection({
    clientId: SF_CLIENT_ID,
    clientSecret: SF_CLIENT_SECRET,
    environment: "production",
    redirectUri: AMZ_REDIRECT_URI,
    mode: 'single',
    autoRefresh: true
});

org.authenticate({username: SF_USER_NAME, password: SF_USER_PASSWORD}, err => {
    if (err) {
        console.error("Salesforce authentication error");
        console.error(err);
    } else {
        console.log("Salesforce authentication successful");
        console.log(org.oauth.instance_url);
        subscribeToPlatformEvents();
    }
});

// Subscribe to Platform Events
let subscribeToPlatformEvents = () => {
    var client = new faye.Client(org.oauth.instance_url + '/cometd/40.0/');
    client.setHeader('Authorization', 'OAuth ' + org.oauth.access_token);
    client.subscribe('/event/NewLead__e', function(message) {
        // Send message to all connected Socket.io clients
        if (DISPATCH_LOCAL) {
            dispatchLocal('handleLead', message.payload);
        } else {
            dispatchCloud('handleLead', message.payload);
        }
    });
    client.subscribe('/event/LeadProcessed__e', function(message) {
        // Send message to all connected Socket.io clients
        if (DISPATCH_LOCAL) {
            dispatchLocal('finalizeLead', message.payload);
        } else {
            dispatchCloud('finalizeLead', message.payload);
        }
    });
};

let dispatchLocal = (funcname, payload) => {
    var lamfuncs = require('./index.js');
    var event = {body: payload, auth: {access_token: org.oauth.access_token, instance_url: org.oauth.instance_url}};
    lamfuncs[funcname](event, {}, function(err, result) {
        console.log("Handler returned: ", result);
    });
}

let dispatchCloud = (funcname, payload) => {
    var stack = "pefuncs-demo1"
    var event = {body: payload, auth: {access_token: org.oauth.access_token, instance_url: org.oauth.instance_url}};
    var params = {
        FunctionName: funcname, 
        InvocationType: "RequestResponse", 
        LogType: "Tail", 
        Payload: JSON.stringify(event)
     };
    lambda.invoke(params, function(err, data) {
        if (err) console.log(err, err.stack); // an error occurred
        else     console.log(data);           // successful response
    });   
}

let callLambda = (payload) => {
    console.log("[payload] ", payload);
    var params = {
        FunctionName: "hello-world-python", 
        InvocationType: "RequestResponse", 
        LogType: "Tail", 
        Payload: JSON.stringify(payload)
     };
    lambda.invoke(params, function(err, data) {
        if (err) console.log(err, err.stack); // an error occurred
        else     console.log(data);           // successful response
    });   
}

let requestAccessToken = (code, redirect_uri) => {
    request.post('https://api.amazon.com/auth/o2/token', 
        {form: {
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: redirect_uri,
            client_id: AMZ_CLIENT_ID,
            client_secret: AMZ_CLIENT_SECRET
        }},
        function(err, httpResponse, body){
            if (err) {
                console.log("Auth request err: ", err);
            }
            body = JSON.parse(body);
            console.log("Auth request result: ", body);
            var access_token = body.access_token;
            request.get('https://api.amazon.com/user/profile?access_token=' + access_token,
                function(err, httpResponse, body) {
                    console.log("Profile: ", body);
                }
            );
        }
    );
}

// =================== EXPRESS ====================
var express = require('express')
var app = express()

app.get('/openid/callback', function(req, res) {
    console.log(req.query);
    res.send("Login with Amazon done: " + JSON.stringify(req.query));
    requestAccessToken(req.query.code, AMZ_REDIRECT_URI);

    /*
    AWS.config.credentials = new AWS.WebIdentityCredentials({
        RoleArn: 'arn:aws:iam::040552978376:role/service-role/mylambdarole',
        ProviderId: 'www.amazon.com', // Omit this for Google
        WebIdentityToken: ACCESS_TOKEN // Access token from identity provider
    });*/
})

app.use(express.static('views'))
app.listen(3000, function () {
  console.log('Example app listening on port 3000!')
})

