/**@flow 
 * This is the server which will calculate the needed ci metrics data
 */

const express = require('express')
const graphqlHTTP = require('express-graphql')
import { buildSchema } from 'graphql'
import { schema } from "./schema"
import { main } from "./metrics"

const root = {
    getMetrics: () => {
        
    }
}