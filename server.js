#!/usr/bin/env node
let fs = require('fs');
let yaml = require('js-yaml')
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

var DISPATCH_LOCAL = false;
var RECORD = false;
var PLAYBACK = false;
let recording_file = './events.log'

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
        startCommander();
    }
});

// Subscribe to Platform Events
let subscribeToPlatformEvents = (config_file) => {
    var config = yaml.safeLoad(fs.readFileSync(config_file));
    var subs = config.Metadata.PESubscriptions

    var client = new faye.Client(org.oauth.instance_url + '/cometd/40.0/');
    client.setHeader('Authorization', 'OAuth ' + org.oauth.access_token);

    for (let eventkey in subs) {
        console.log(`Subscribing to platform event '${eventkey}'`)
        client.subscribe(`/event/${eventkey}`, (function(eventName, targetFunc) {
            return function(message) {
                // Send message to all connected Socket.io clients
                if (RECORD) {
                    var packet = {}
                    console.log("Recording event for key ", eventName)
                    packet[eventName] = message
                    fs.appendFileSync(recording_file, JSON.stringify(packet) + "\n");
                }
                if (DISPATCH_LOCAL) {
                    dispatchLocal(targetFunc, message.payload);
                } else {
                    dispatchCloud(targetFunc, message.payload);
                }
            }
        }(eventkey, subs[eventkey]))
        );
    }
};

let replayRecordedEvents = (config_file) => {
    var config = yaml.safeLoad(fs.readFileSync(config_file));
    var subs = config.Metadata.PESubscriptions

    var lineReader = require('readline').createInterface({
      input: fs.createReadStream(recording_file)
    });

    lineReader.on('line', function (line) {
      var event = JSON.parse(line)
      for (var eventkey in event) {
        var message = event[eventkey];
        var targetFunc = subs[eventkey]
        if (DISPATCH_LOCAL) {
            dispatchLocal(targetFunc, message.payload);
        } else {
            dispatchCloud(targetFunc, message.payload);
        }       
      }
    });
}

let dispatchLocal = (funcname, payload) => {
    var funcparts = funcname.split(".")
    var modname = funcparts[0]
    var funcname = funcparts[1]
    var lamfuncs = require(`./${modname}`);
    if (lamfuncs[funcname] === undefined) {
        console.log(`Error, function '${funcname}' not found in index.js`)
        return;
    }
    var event = {body: payload, auth: {access_token: org.oauth.access_token, instance_url: org.oauth.instance_url}};
    lamfuncs[funcname](event, {}, function(err, result) {
        console.log("Handler returned: ", result);
    });
}

let dispatchCloud = (funcname, payload) => {
    var funcparts = funcname.split(".")
    var event = {body: payload, auth: {access_token: org.oauth.access_token, instance_url: org.oauth.instance_url}};
    var params = {
        FunctionName: funcparts[1], 
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

let startCommander = () => {
    let program = require('commander');

    program
      .version('0.0.1')
      .option('-r --record', 'Record events for later playback')
      .option('-p --playback', 'Playback previous recorded events')
      .command('start <local|cloud>')
      .action(function(target) {
        if (program.record) {
            RECORD = true;
            if (fs.existsSync(recording_file)) {
                fs.truncateSync(recording_file);
            }
            console.log("..recording events")
        }
        if (target == 'local') {
            DISPATCH_LOCAL = true;
        } else {
            DISPATCH_LOCAL = false;
        }
        if (program.playback) {
            PLAYBACK = true;
            replayRecordedEvents('./subscriptions.yml');
        } else {
            subscribeToPlatformEvents('./subscriptions.yml');
        }
      });

    program.parse(process.argv);   
}
