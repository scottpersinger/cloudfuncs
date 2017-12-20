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

![Alt text](https://g.gravizo.com/source/custom_mark13?https%3A%2F%2Fgithub.com%2Fscottpersinger%2Fcloudfuncs%2Fedit%2Fmaster%2FREADME.md)
<details> 
<summary></summary>
custom_mark13
@startuml;
actor User;
participant "First Class" as A;
participant "Second Class" as B;
participant "Last Class" as C;
User -> A: DoWork;
activate A;
A -> B: Create Request;
activate B;
B -> C: DoWork;
activate C;
C -> B: WorkDone;
destroy C;
B -> A: Request Created;
deactivate B;
A -> User: Done;
deactivate A;
@enduml
custom_mark13
</details>
