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

![Alt text](https://g.gravizo.com/svg?
  digraph G {
    aize ="4,4";
    main [shape=box];
    main -> parse [weight=8];
    parse -> execute;
    main -> init [style=dotted];
    main -> cleanup;
    execute -> { make_string; printf}
    init -> make_string;
    edge [color=red];
    main -> printf [style=bold,label="100 times"];
    make_string [label="make a string"];
    node [shape=box,style=filled,color=".7 .3 1.0"];
    execute -> compare;
  }
)
