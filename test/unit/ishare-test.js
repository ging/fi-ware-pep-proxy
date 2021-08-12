/*
 * Copyright 2021 -  Universidad Politécnica de Madrid.
 *
 * This file is part of Keyrock
 *
 */

const got = require('got');
const should = require('should');
const nock = require('nock');
const cache = require('../../lib/cache');
const jwt = require('jsonwebtoken');

const ngsiPayload = [
  {
    id: 'urn:ngsi-ld:TemperatureSensor:002',
    type: 'TemperatureSensor',
    category: {
      type: 'Property',
      value: 'sensor'
    },
    temperature: {
      type: 'Property',
      value: 21,
      unitCode: 'CEL'
    }
  },
  {
    id: 'urn:ngsi-ld:TemperatureSensor:003',
    type: 'TemperatureSensor',
    category: {
      type: 'Property',
      value: 'sensor'
    },
    temperature: {
      type: 'Property',
      value: 27,
      unitCode: 'CEL'
    }
  }
];

const token = jwt.sign(
  {
    app_id: 'application_id',
    trusted_apps: [],
    id: 'username',
    displayName: 'Some User',
    delegationEvidence: {
      notBefore: Math.floor(new Date().getTime() / 1000) - 2000,
      notOnOrAfter: Math.floor(new Date().getTime() / 1000) + 2000,
      policyIssuer: 'EU.EORI.NLPACKETDEL',
      target: {
        accessSubject: 'EU.EORI.NLNOCHEAPER'
      },
      policySets: [
        {
          maxDelegationDepth: 1,
          target: {
            environment: {
              licenses: ['ISHARE.0001']
            }
          },
          policies: [
            {
              target: {
                resource: {
                  type: 'TemperatureSensor',
                  identifiers: ['*'],
                  attributes: ['*']
                },
                actions: ['GET', 'PATCH']
              },
              rules: [
                {
                  effect: 'Permit'
                }
              ]
            },
            {
              target: {
                resource: {
                  type: 'SoilSensor',
                  identifiers: ['*'],
                  attributes: ['*']
                },
                actions: ['GET']
              },
              rules: [
                {
                  effect: 'Permit'
                }
              ]
            }
          ]
        }
      ]
    }
  },
  'shhhhh'
);

const request_with_jwt = {
  prefixUrl: 'http:/localhost:80',
  throwHttpErrors: false,
  headers: { 'x-auth-token': token },
  retry: 0
};

const request_with_jwt_and_body = {
  prefixUrl: 'http:/localhost:80',
  throwHttpErrors: false,
  headers: { 'x-auth-token': token },
  json: ngsiPayload,
  retry: 0
};

const config = {
  magic_key: '999999999',
  pep_port: 80,
  pep: {
    app_id: 'application_id',
    trusted_apps: [],
    token: { secret: 'shhhhh' }
  },
  idm: {
    host: 'keyrock.com',
    port: '3000',
    ssl: false
  },
  app: {
    host: 'fiware.org',
    port: '1026',
    ssl: false // Use true if the app server listens in https
  },
  organizations: {
    enabled: false
  },
  cache_time: 300,
  public_paths: ['/public'],
  authorization: {
    enabled: true,
    pdp: 'ishare', // idm|iShare|xacml|authzforce|opa|azf
    header: 'fiware-service',
    ishare: {
      protocol: 'http',
      host: 'ishare.org',
      port: 8080
    }
  }
};

const ishare_policy_recognized = 'HELLO';
const ishare_policy_not_recognized = 'WORLD';

describe('Authorization: iSHARE PDP', () => {
  let pep;
  let contextBrokerMock;
  let iShareMock;

  beforeEach((done) => {
    const app = require('../../app');
    pep = app.start_server('12345', config);
    nock.cleanAll();
    cache.flush();
    done();
  });

  afterEach((done) => {
    pep.close(config.pep_port);
    done();
  });

  describe('When a restricted URL matches the JWT policy and is legitimate', () => {
    beforeEach(() => {
      contextBrokerMock = nock('http://fiware.org:1026')
        .get('/path/entities/urn:ngsi-ld:SoilSensor:1111?type=SoilSensor')
        .reply(200, {});
      iShareMock = nock('http://ishare.com:8080').post('/delegate').reply(200, ishare_policy_recognized);
    });

    it('should allow access', (done) => {
      got.get('path/entities/urn:ngsi-ld:SoilSensor:1111?type=SoilSensor', request_with_jwt).then((response) => {
        contextBrokerMock.done();
        //iShareMock.done();
        should.equal(response.statusCode, 200);
        done();
      });
    });
  });

  describe('When a restricted URL does not match the attached JWT policy', () => {
    it('should deny access', (done) => {
      got.get('path/entities/urn:ngsi-ld:Tractor:1111?type=Tractor', request_with_jwt).then((response) => {
        //iShareMock.done();
        should.equal(response.statusCode, 401);
        done();
      });
    });
  });

  xdescribe('When a JWT policy is not recognized by the iSHARE delegate', () => {
    beforeEach(() => {
      iShareMock = nock('http://ishare.com:8080').post('/delegate').reply(200, ishare_policy_not_recognized);
    });

    it('should deny access', (done) => {
      got.get('path/entities/urn:ngsi-ld:SoilSensor:1111', request_with_jwt).then((response) => {
        //iShareMock.done();
        should.equal(response.statusCode, 401);
        done();
      });
    });
  });

  describe('When a restricted URL with a string is requested', () => {
    beforeEach(() => {
      contextBrokerMock = nock('http://fiware.org:1026')
        .get('/path/entities/?ids=urn:ngsi-ld:SoilSensor:1111&type=SoilSensor')
        .reply(200, {});
      iShareMock = nock('http://ishare.com:8080').post('/delegate').reply(200, ishare_policy_recognized);
    });

    it('should allow access based on the JWT policy and entities', (done) => {
      got.get('path/entities/?ids=urn:ngsi-ld:SoilSensor:1111&type=SoilSensor', request_with_jwt).then((response) => {
        contextBrokerMock.done();
        //iShareMock.done();
        should.equal(response.statusCode, 200);
        done();
      });
    });
  });

  describe('When a restricted URL with a payload body is requested', () => {
    beforeEach(() => {
      iShareMock = nock('http://ishare.com:8080').post('/delegate').reply(200, ishare_policy_recognized);
      contextBrokerMock = nock('http://fiware.org:1026').patch('/path/entityOperations/upsert').reply(200, {});
    });

    it('should allow access based on the JWT policy and entities', (done) => {
      got.patch('path/entityOperations/upsert', request_with_jwt_and_body).then((response) => {
        contextBrokerMock.done();
        //iShareMock.done();
        should.equal(response.statusCode, 200);
        done();
      });
    });
  });
});
