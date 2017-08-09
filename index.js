var jsforce = require('jsforce');
var AWS = require('aws-sdk');
var dynamodb = new AWS.DynamoDB({region: 'us-east-1'});

exports.handleLead = (event, context, callback) => {
    // Event contains multiple prooperties
    //   body - This is the content of the platform event
    //   auth - Salesforce authentication data
    //     .access_token
    //     .instance_url
    console.log("Received platform event: ", event.body)
    console.log("From org: ", event.meta.organization_id)

/*    
    console.log("Accessing DynamoDB")
    dynamodb.listTables(function(err, data) {
        console.log("Inside list tables result");
        console.log(JSON.stringify(data, null, '  '));
        callback(null, 'Finished from Dynamo call');
    });
*/

    console.log("Connecting to Salesforce")

    var conn = new jsforce.Connection({
      instanceUrl : event.auth.instance_url,
      accessToken : event.auth.access_token
    });

    console.log("Retrieving Lead record")
    conn.sobject("Lead").retrieve(event.body.LeadId__c, function(err, lead) {
        if (err) console.log("Error retrieving lead: ", err);
        console.log("Retrieved lead: ");
        console.log("  id: ", lead.Id)
        console.log("  name:", lead.Name)
        console.log("  email: ", lead.Email)

        conn.sobject("Task").create({Subject: "Qualify this lead", WhoId: lead.Id}, function(err, ret) {
            if (err || !ret.success) { return console.error(err, ret); }
            console.log("Created task with record id : " + ret.id);

            if (lead.ProductInterest__c) {
                console.log("Lead has product interest, publishing InterestLead event")
                conn.sobject("InterestLead__e").create(
                    {LeadId__c: lead.Id, 
                     ProductInterest__c: lead.ProductInterest__c,
                     LeadName__c: lead.Name
                    }, function(err, ret) {
                        if (err) { return callback(err, ret)}
                        callback(null, "Processed lead " + lead.Id);
                    }
                )
            } else {
                callback(null, "Processed lead " + lead.Id);
            }
        });
        /*
        console.log("Publishing finalize event");
        conn.sobject("LeadProcessed__e").create({ LeadId__c : lead.Id }, function(err, ret) {
            if (err || !ret.success) { return console.error(err, ret); }
            console.log("Created record id : " + ret.id);
        });
        */
    });
}

exports.notifyLeadWithInterest = (event, context, callback) => {
    console.log("Received InterestLead event: ", event.body)
    var sns = new AWS.SNS();
    var params = {
        Message: `${event.body.LeadName__c} is interested in ${event.body.ProductInterest__c}!`,
        PhoneNumber: "+15107084560"
    }
    sns.publish(params, function(err, data) {
        if (err) console.log(err, err.stack); // an error occurred
        else     console.log(data);           // successful response
        callback(null, "[Done]")
    });
}


exports.finalizeLead = (event, context, callback) => {
    console.log("LEAD finalized! ", event.body);
    callback(null, "Done");
}
