import chromium from 'chrome-aws-lambda'
import path from 'path'
import fs from 'fs'
import handlebars from 'handlebars'
import dayjs from 'dayjs'
import { S3 } from 'aws-sdk'

import { document } from '../utils/dynamodb-client'

const compile = async function(data) {
  const filePath = path.join(process.cwd(), 'src', 'templates', 'certificate.hbs')
  const html = fs.readFileSync(filePath, 'utf-8')

  return handlebars.compile(html)(data)
}

export const handle = async event => {
  const { id, name, grade } = JSON.parse(event.body)

  const response = document.query({
    TableName: 'users_certificates',
    KeyConditionExpression: 'id = :id',
    ExpressionAttributeValues: {
      ':id': id
    }
  }).promise()

  const user = (await response).Items[0]

  if (!user) {
    await document.put({
      TableName: 'users_certificates',
      Item: {
        id,
        name,
        grade
      }
    }).promise()
  }

  const medalPath = path.join(process.cwd(), 'src', 'templates',  'selo.png')
  const medal = fs.readFileSync(medalPath,  'base64')

  const data = {
    date: dayjs().format('DD/MM/YYYY'),
    grade,
    name,
    id,
    medal
  }

  const content = await compile(data)

  const browser = await chromium.puppeteer.launch({
    headless: true,
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath
  })

  const page = await browser.newPage()

  await page.setContent(content)

  const pdf = await page.pdf({
    format: 'a4',
    landscape: true,
    path: process.env.IS_OFFLINE ? 'certificate.pdf' : null,
    printBackground: true,
    preferCSSPageSize: true
  })

  await browser.close()

  const s3 = new S3()

  await s3.putObject({
    Bucket: 'some-bucket',
    Key: `${id}.pdf`,
    ACL: 'public-read',
    Body: pdf,
    ContentType: 'application/pdf'
  }).promise()

  return {
    statusCode: 201,
    body: JSON.stringify({
      message: 'Certificate created!',
      url: `aws-s3-link/${id}.pdf`
    }),
    headers: {
      'Content-type': 'application/json'
    }
  }
}
