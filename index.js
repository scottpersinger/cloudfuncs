var jsforce = require('jsforce');
var AWS = require('aws-sdk');
var dynamodb = new AWS.DynamoDB({region: 'us-east-1'});

exports.handleLead = (event, context, callback) => {
    // Event contains multiple prooperties
    //   body - This is the content of the platform event
    //   auth - Salesforce authentication data
    //     .access_token
    //     .instance_url
    console.log("Received platform event: ", event)
    console.log("Accessing DynamoDB")
    dynamodb.listTables(function(err, data) {
        console.log("Inside list tables result");
        console.log(JSON.stringify(data, null, '  '));
        callback(null, 'Finished from Dynamo call');
    });

    /*
    console.log("Connecting to Salesforce")

    var conn = new jsforce.Connection({
      instanceUrl : event.auth.instance_url,
      accessToken : event.auth.access_token
    });

    console.log("Retrieving Lead record")
    conn.sobject("Lead").retrieve(event.body.LeadId__c, function(err, lead) {
        if (err) console.log("Error retrieving lead: ", err);
        console.log("Retrieved lead: ", lead);

        console.log("Publishing finalize event");
        conn.sobject("LeadProcessed__e").create({ LeadId__c : lead.Id }, function(err, ret) {
            if (err || !ret.success) { return console.error(err, ret); }
            console.log("Created record id : " + ret.id);
        });
    });
     */
}

exports.finalizeLead = (event, context, callback) => {
    console.log("LEAD finalized! ", event.body);
    callback(null, "Done");
}
