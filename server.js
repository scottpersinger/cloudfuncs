#!/usr/bin/env node
let fs = require('fs');
let util = require('util')
let path = require('path')
let http = require('http')
let https = require('https')
let Duplex = require('stream').Duplex;  

let yaml = require('js-yaml')
let request = require('request');
let unzip = require('unzip-stream')

let jsforce = require('jsforce');
var jwtflow = require('salesforce-jwt');
let faye = require('faye');
let AWS = require('aws-sdk');
AWS.config.update({region:'us-east-1'});
let lambda = new AWS.Lambda();
let dynamo = new AWS.DynamoDB.DocumentClient();
let s3 = new AWS.S3()

let AMZ_CLIENT_ID = process.env.AMZ_CLIENT_ID;
let AMZ_CLIENT_SECRET = process.env.AMZ_CLIENT_SECRET;
let AMZ_REDIRECT_URI = 'http://localhost:3000/openid/callback';

let SF_CLIENT_ID = process.env.SF_CLIENT_ID;
let SF_CLIENT_SECRET = process.env.SF_CLIENT_SECRET;

var DISPATCH_LOCAL = false;
var RECORD = false;
var PLAYBACK = false;
let recording_file = './events.log'
let CLIENTS = {}
let USERS = {}
let USERS_TABLE = "cloudfuncs-users"
let CONFIG_TABLE = "cloudfuncs-config"
let SUBS = {}
let HOST_ENDPOINT = 'http://localhost:5000/'

let loadUsers = () => {
    dynamo.get({TableName: CONFIG_TABLE, Key: {key: "app_target"}}, function(err, data) {
        if (err) {
            console.log("Dynamo error reading app target: ", err)
        } else {
            HOST_ENDPOINT = data.Item.value;
        }
    })
    dynamo.scan({TableName: USERS_TABLE}, function(err, data) {
        if (err) {
            console.error("Dynamo error reading users: ", err);
        } else {
            data.Items.forEach((user) => {
                USERS[user.user_id] = user
            })
        }
    })
}

let getProjectFile = (name, callback) => {
    s3.getObject({Bucket: "cloudfuncs-codeprojects-dev", Key: "project1.zip"}, function(err, data) {
        if (err) {
            console.error("Error reading project from S3 ", err)
            callback(err, null)
        } else {
            let stream = new Duplex();
            stream.push(data.Body)
            stream.push(null)
            var fileFound = false;
            stream.pipe(unzip.Parse()).on('entry', (entry) => {
                if (entry.path.match(new RegExp(name + '$'))) {
                    fileFound = true
                    var parts = []
                    entry.on('data', (part) => {parts.push(part)})
                    entry.on('end', () => {
                        callback(null, Buffer.concat(parts).toString('utf-8'))
                        fileFound = true
                    })
                }
            }).on('end', () => {
                if (!fileFound) {                   
                    callback("File not found", null)
                }
            })
        }
    })
}

let loadSubscriptions = (callback) => {
    getProjectFile("subscriptions.yml", (err, content) => {
        if (err) {
            console.log("Error loading subscriptions file: ", err)
        } else {
            var config = yaml.safeLoad(content);
            SUBS = config.Metadata.PESubscriptions
            callback()
        }
    })
}

let saveUser = (userInfo) => {
    console.log("Saving: ", userInfo)
    USERS[userInfo.user_id] = userInfo
    userInfo.project_id = "1"
    var params = {
        TableName: USERS_TABLE, Item: userInfo
    }
    dynamo.put(params, function(err, data) {
        if (err) {
            console.error("Dynamo error: ", err);
        }
    })
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
            var privateKey = fs.readFileSync(path.join(__dirname, 'certs/PrivateKey.key'))
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

    console.log(`==> ${HOST_ENDPOINT}/${funcname}`)
    request.post({
        url: HOST_ENDPOINT,
        method: 'POST',
        json: {key: "123", payload: event, function: funcname}
    }, function (error, resp, body) { 
        console.log("<== ", body)
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
var bodyParser = require('body-parser')

app.use(bodyParser.json())

app.get('/openid/callback', function(req, res) {
    console.log(req.query);
    res.send("Login with Amazon done: " + JSON.stringify(req.query));
    requestAccessToken(req.query.code, AMZ_REDIRECT_URI);
})

app.use(express.static('./views'))
app.set('view engine', 'ejs')
app.set('views', './views')

var oauth2 = new jsforce.OAuth2({
  // you can change loginUrl to connect to sandbox or prerelease env.
  // loginUrl : 'https://test.salesforce.com',
  clientId : process.env.SF_CLIENT_ID,
  clientSecret : process.env.SF_CLIENT_SECRET,
  redirectUri : process.env.SF_REDIRECT_URI
});

app.get('/', function (req, res) {

    res.render('index', { users: USERS, subs: SUBS, endpoint: HOST_ENDPOINT })
})

app.get('/dashboard/getfunc/:funcname', function(req, res) {
    var parts = req.params.funcname.split(".")
    getProjectFile(parts[0] + "\.js", (err, content) => {
        if (err) {
            res.send(err);
        } else {
            var funcs = eval("(function () {exports = {}; " + content + "; return exports})()")
            var body = funcs[parts[1]].toString()
            res.send(`function ${parts[1]} ${body}`);
        }
    })
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

app.post('/apptarget', function(req, res) {
    console.log("Saving: ", req.body.target);
    dynamo.update({
        TableName: CONFIG_TABLE, 
        Key: {key: "app_target"}, 
        UpdateExpression: "SET #VV = :v",
        ExpressionAttributeNames: {"#VV": "value"},
        ExpressionAttributeValues: {":v": req.body.target}
    }, function(err, data) {
        if (err) {
            console.error("Dynamo error: ", err);
        } else {
            HOST_ENDPOINT = req.body.target;
        }
    })

    res.send("OK")
})

var options = {
  key: fs.readFileSync(path.join(__dirname, 'certs/server.key')),
  cert: fs.readFileSync(path.join(__dirname, 'certs/server.crt'))
};


//var server = https.createServer(options, app)
var server = http.createServer(app)
var io = require('socket.io')(server);
io.on('connection', function(){ 
    console.log("Log stream connected...")
    console.log = function() {
        console.info.apply(console, arguments)
        var args = Array.from(arguments)
        io.emit('message', args.map((elt) => {return util.format(elt)}).join(" "))
    }
});

var port = process.env.PORT || 3000;
server.listen(port, function() {
    console.log('Express HTTPS server listening on port ' + port);
});


let startCommander = () => {
    loadUsers();
    loadSubscriptions(subscribeToPlatformEvents)
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
      }); 

    program.parse(process.argv);   
}
startCommander()
