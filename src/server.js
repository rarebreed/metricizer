/**@flow 
 * This is the server which will calculate the needed ci metrics data
 */

const express = require('express')
const graphqlHTTP = require('express-graphql')
import * as ur from "unirest"
import { buildSchema } from 'graphql'
import { schema } from "./schema"
import { main } from "./metrics"
import type { URLOpts } from "metricizer"
import Rx from "rxjs/Rx"

const root = {
    main: main
}

