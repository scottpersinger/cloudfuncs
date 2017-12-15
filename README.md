# cloudfuncs

```diagram-uml
cloud internet
node apiori
node bapi_srv
node marlin_srv
node sources_srv
internet -- apiori
apiori -- bapi_srv
bapi_srv -- sources_srv
marlin_srv -- sources_srv

```

An experiment with a lambda-style service integrated with Force.com.

```diagram-sequence
Salesforce -> Cloudfuncs: PlatformEvent
Cloudfuncs -> User function: HTTP POST w/event & access key
User function --> Cloudfuncs: status code
Note right of User function: processing...
User function -> Salesforce: API calls
```

