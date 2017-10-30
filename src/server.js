/**@flow 
 * This is the server which will calculate the needed ci metrics data
 */

const express = require('express')
const graphqlHTTP = require('express-graphql')
const http = require("http")
import * as ur from "unirest"
//import { buildSchema } from 'graphql'
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

const bodyParser = require("body-parser")
const jsonParser = bodyParser.json()

// ==================================================
// routes go here
// ==================================================
var app = express();

/*
app.use('/graphql', graphqlHTTP({
  schema: schema,
  rootValue: root,
  graphiql: true,
}))
*/


app.post('/cimetrics', jsonParser, (req, resp) => {
    console.log(req.body)
    let { distro, jenkins } = req.body
    let result = main(distro, jenkins)
    // TODO: Use a setTimeout here so that if we don't respond within a minute, to send
    // a failure response
    result.response.subscribe({
        next: n => {
            resp.send(JSON.stringify(n, null, 2)).status(200).end()
        },
        error: err => {
            resp.send({
                message: "Unable to get CI Metrics JSON"
            }).status(400).end()
        }
    })
})

let service = app.listen(4000, () => console.log('Running cimetrics service at localhost:4000/cimetrics'))