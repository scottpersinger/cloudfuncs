# cloudfuncs

```diagram-uml
cloud internet
node server
database postgres
database redis
node sendgrid
internet -- server
server -- postgres
server -- redis
server -- sendgrid

```

An experiment with a lambda-style service integrated with Force.com.

```diagram-sequence
Salesforce -> Cloudfuncs: PlatformEvent
Cloudfuncs -> User function: HTTP POST w/event & access key
User function --> Cloudfuncs: status code
Note right of User function: processing...
User function -> Salesforce: API calls
```

