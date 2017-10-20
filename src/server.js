/**@flow 
 * This is the server which will calculate the needed ci metrics data
 */

const express = require('express')
const graphqlHTTP = require('express-graphql')
import * as ur from "unirest"
import { buildSchema } from 'graphql'
import { schema } from "./schema"
import { main } from "./metrics"
import type { URLOpts, Distro } from "metricizer"
import Rx from "rxjs/Rx"

function server(opts: Distro, urlOpts: URLOpts) {
    let result = main(opts, urlOpts)
    let response: Rx.AsyncSubject<string> = result.response
    return response.toPromise()
}

const root = {
    cidata: server
}

// ==================================================
// routes go here
// ==================================================
var app = express();
app.use('/graphql', graphqlHTTP({
  schema: schema,
  rootValue: root,
  graphiql: true,
}));

app.listen(4000, () => console.log('Running a GraphQL API server at localhost:4000/graphql'));