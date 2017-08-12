#!/usr/bin/env node
let fs = require('fs');
let util = require('util')
let path = require('path')
let https = require('https')
let yaml = require('js-yaml')
let request = require('request');
let jsforce = require('jsforce');
var jwtflow = require('salesforce-jwt');
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
let CLIENTS = {}
let USERS = {}
let SUBS = {}
let HOST_ENDPOINT = 'http://localhost:5000/'

let loadUsers = () => {
    if (fs.existsSync('./users.json')) {
        USERS = JSON.parse(fs.readFileSync('./users.json'))
    }   
}

let loadSubscriptions = (config_file) => {
    var config = yaml.safeLoad(fs.readFileSync(config_file));
    SUBS = config.Metadata.PESubscriptions
}

let saveUser = (userInfo) => {
    console.log("Saving: ", userInfo)
    USERS[userInfo.user_id] = userInfo
    fs.writeFileSync('./users.json', JSON.stringify(USERS))
}

let getClient = (orgId, callback) => {
    if (CLIENTS[orgId]) {
        return CLIENTS[orgId]
    } else {
        // Find a user from the org
        var userRec = null;
        for (var userId in USERS) {
            if (USERS[userId].organization_id == orgId) {
                userRec = USERS[userId];
                break;
            }
        }
        if (userRec) {
            // Grab new access token via JWT
            var privateKey = fs.readFileSync(path.join(process.env.HOME, 'src/certs/PrivateKey.key'))
            jwtflow.getToken(SF_CLIENT_ID, privateKey, userRec.username, function(err, accessToken) {
                if (err) {
                    callback(err, null)
                } else {
                    console.log("Got new token ", accessToken)
                    userRec.access_token = accessToken
                }
     
                var conn = new jsforce.Connection({
                    instanceUrl: userRec.instance_url,
                    accessToken: userRec.access_token
                });
                callback(null, {conn: conn, userRec: userRec});
            })
        } else {
            return null;
        }
    }
}

// Subscribe to Platform Events
let subscribeToPlatformEvents = () => {
    for (let eventkey in SUBS) {
        SUBS[eventkey].connections.forEach(function (orgId) {
            console.log(`Subscribing to platform event '${eventkey}' from Org ${orgId}`)
            getClient(orgId, function(err, tuple) {              
                if (err) {
                    console.log("Error: no connection for Org: ", orgId, " from error ", err);
                    return;
                }
                var client = tuple.conn;
                var userRec = tuple.userRec;
                client.streaming.topic(`/event/${eventkey}`).subscribe((function(eventName, targetFunc, userRec) {
                    return function(message) {
                        console.log("Got a platform event: ", message);
                        if (RECORD) {
                            var packet = {}
                            console.log("Recording event for key ", eventName)
                            packet[eventName] = message
                            fs.appendFileSync(recording_file, JSON.stringify(packet) + "\n");
                        }
                        if (DISPATCH_LOCAL) {
                            dispatchHeroku(targetFunc, message.payload, userRec);
                        } else {
                            dispatchCloud(targetFunc, message.payload, userRec);
                        }
                    }
                }(eventkey, SUBS[eventkey].function, userRec))
                );
            })
        })
    }
};

let replayRecordedEvents = () => {
    var lineReader = require('readline').createInterface({
      input: fs.createReadStream(recording_file)
    });

    lineReader.on('line', function (line) {
      var event = JSON.parse(line)
      for (var eventkey in event) {
        var message = event[eventkey];
        var targetFunc = SUBS[eventkey]
        if (DISPATCH_LOCAL) {
            dispatchLocal(targetFunc, message.payload);
        } else {
            dispatchCloud(targetFunc, message.payload);
        }       
      }
    });
}

let dispatchHeroku = (funcname, payload, userRec) => {
    var event = {body: payload, auth: {access_token: userRec.access_token, instance_url: userRec.instance_url},
                  meta: {organization_id: userRec.organization_id}};

    console.log("Calling local server for ", funcname)
    request.post({
        url: HOST_ENDPOINT,
        method: 'POST',
        json: {key: "123", payload: event, function: funcname}
    }, function (error, resp, body) { 
        console.log("Function invoke returned: ", body)
    })
}

let dispatchLocal = (funcname, payload, userRec) => {
    var funcparts = funcname.split(".")
    var modname = funcparts[0]
    var funcname = funcparts[1]
    var lamfuncs = require(`./${modname}`);
    if (lamfuncs[funcname] === undefined) {
        console.log(`Error, function '${funcname}' not found in index.js`)
        return;
    }
    var event = {body: payload, auth: {access_token: userRec.access_token, instance_url: userRec.instance_url},
                  meta: {organization_id: userRec.organization_id}};
    lamfuncs[funcname](event, {}, function(err, result) {
        console.log("Handler returned: ", result);
    });
}

let dispatchCloud = (funcname, payload, userRec) => {
    var funcparts = funcname.split(".")
    var event = {body: payload, auth: {access_token: userRec.access_token, instance_url: userRec.instance_url},
                  meta: {organization_id: userRec.organization_id}};
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

app.use(express.static('./views'))
app.set('view engine', 'ejs')
app.set('views', './views')

var oauth2 = new jsforce.OAuth2({
  // you can change loginUrl to connect to sandbox or prerelease env.
  // loginUrl : 'https://test.salesforce.com',
  clientId : process.env.SF_CLIENT_ID,
  clientSecret : process.env.SF_CLIENT_SECRET,
  redirectUri : 'https://localhost:3000/sf/callback'
});

app.get('/', function (req, res) {

    res.render('index', { users: USERS, subs: SUBS })
})

app.get('/dashboard/getfunc/:funcname', function(req, res) {
    var parts = req.params.funcname.split(".")
    var mod = require(`./${parts[0]}`)
    var thefunc = mod[parts[1]]
    res.send(`function ${parts[1]} ${thefunc.toString()}`);
})

app.get('/oauth2/auth', function(req, res) {
  res.redirect(oauth2.getAuthorizationUrl({prompt: "select_account"}));
});

app.get('/sf/callback', function(req, res) {
    var conn = new jsforce.Connection({ oauth2 : oauth2 });
    var code = req.param('code');
    conn.authorize(code, function(err, userInfo) {
    if (err) { return console.error(err); }
        // Now you can get the access token, refresh token, and instance URL information.
        // Save them to establish connection next time.
        console.log(conn.accessToken);
        console.log(conn.refreshToken);
        console.log(conn.instanceUrl);
        console.log("User ID: " + userInfo.id);
        console.log("Org ID: " + userInfo.organizationId);
        conn.identity(function(err, res) {
            saveUser({username: res.username, idurl: res.id, instance_url: conn.instanceUrl, 
                        access_token: conn.accessToken, refresh_token: conn.refreshToken,
                        organization_id: userInfo.organizationId, user_id: userInfo.id})
        })
        // ...
        res.send('<html><body><h2>success</h2><a href="/">Home</a></body></html'); // or your desired response
  });
})

var options = {
  key: fs.readFileSync(path.join(process.env.HOME, 'src/certs/server.key')),
  cert: fs.readFileSync(path.join(process.env.HOME, 'src/certs/server.crt'))
};


var server = https.createServer(options, app)
var io = require('socket.io')(server);
io.on('connection', function(){ 
    console.log("Log stream connected...")
    console.log = function() {
        console.info.apply(console, arguments)
        var args = Array.from(arguments)
        io.emit('message', args.map((elt) => {return util.format(elt)}).join(" "))
    }
});

server.listen(3000, function() {
    console.log('Express HTTPS server listening on port ' + app.get('port'));
});


let startCommander = () => {
    loadUsers();
    loadSubscriptions('./subscriptions.yml')
    let program = require('commander');

    program
      .version('0.0.1')
      .option('-h --host [value]', 'Functions endpoint')
      .option('-r --record', 'Record events for later playback')
      .option('-p --playback', 'Playback previous recorded events')
      .command('start <local|cloud>')
      .action(function(target) {
        if (program.host) {
            HOST_ENDPOINT = program.host
        }
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
            replayRecordedEvents();
        } else {
            subscribeToPlatformEvents();
        }
      });

    program.parse(process.argv);   
}
startCommander()
