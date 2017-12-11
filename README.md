# cloudfuncs

An experiment with a lambda-style service integrated with Force.com.

```diagram-sequence
Salesforce -> Cloudfuncs: PlatformEvent
Cloudfuncs -> User function: HTTP POST w/event & access key
User function --> Cloudfuncs: status code
Note right of User function: processing...
User function -> Salesforce: API calls
```
```diagram-uml
class Dog -- Animal
class Cat -- Animal
```
