const jobIdParameter = {
  name: 'jobId',
  in: 'path',
  required: true,
  description: 'The job id returned by `POST /api/jobs`.',
  schema: { type: 'string', format: 'uuid' },
};

const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Weather Image API',
    version: '1.0.0',
    description: [
      'Generates an image for every Buienradar weather station, with the current weather drawn onto a public photo.',
      '',
      '1. `POST /api/jobs` (requires the bearer token) queues a new job and returns its id immediately.',
      '2. `GET /api/jobs/{jobId}` reports progress while the background workers fan out over the stations.',
      '3. `GET /api/jobs/{jobId}/images` returns a time-limited SAS link to every generated image.',
    ].join('\n'),
  },
  servers: [{ url: '/', description: 'This deployment' }],
  tags: [{ name: 'Jobs' }, { name: 'Health' }],
  paths: {
    '/api/jobs': {
      post: {
        tags: ['Jobs'],
        summary: 'Start a new image generation job',
        description: 'Queues the job on the start queue and returns straight away; the work happens in the background.',
        security: [{ bearerAuth: [] }],
        responses: {
          202: {
            description: 'Job accepted and queued.',
            headers: { Location: { description: 'URL of the job status.', schema: { type: 'string' } } },
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JobAccepted' } } },
          },
          401: errorResponse('Missing or invalid bearer token.'),
        },
      },
    },
    '/api/jobs/{jobId}': {
      get: {
        tags: ['Jobs'],
        summary: 'Get the status and progress of a job',
        parameters: [jobIdParameter],
        responses: {
          200: {
            description: 'The job.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Job' } } },
          },
          400: errorResponse('The job id is not a UUID.'),
          404: errorResponse('No job with this id exists.'),
        },
      },
    },
    '/api/jobs/{jobId}/images': {
      get: {
        tags: ['Jobs'],
        summary: 'List the generated images of a job',
        description:
          'Returns a read-only SAS link for every image generated so far. While the job is still `processing` the ' +
          'list grows as stations finish.',
        parameters: [jobIdParameter],
        responses: {
          200: {
            description: 'The generated images.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JobImages' } } },
          },
          400: errorResponse('The job id is not a UUID.'),
          404: errorResponse('No job with this id exists.'),
        },
      },
    },
    '/api/jobs/{jobId}/images/{stationId}': {
      get: {
        tags: ['Jobs'],
        summary: 'Redirect to the image of a single station',
        description: 'Redirects to a SAS link for the image. Open it in a browser to view the image directly.',
        parameters: [
          jobIdParameter,
          { name: 'stationId', in: 'path', required: true, schema: { type: 'integer', example: 6260 } },
        ],
        responses: {
          302: { description: 'Redirect to the image in Blob Storage.' },
          400: errorResponse('The job id is not a UUID.'),
          404: errorResponse('The job or the station image does not exist (yet).'),
        },
      },
    },
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Health check',
        responses: {
          200: {
            description: 'The API is up.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'healthy' },
                    timestamp: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', description: 'The ACCESS_TOKEN configured at deploy time.' },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: { error: { type: 'string' } },
      },
      JobStatus: {
        type: 'string',
        enum: ['queued', 'fetching', 'processing', 'completed', 'failed'],
      },
      JobLinks: {
        type: 'object',
        properties: {
          status: { type: 'string', format: 'uri' },
          images: { type: 'string', format: 'uri' },
        },
      },
      JobAccepted: {
        type: 'object',
        properties: {
          jobId: { type: 'string', format: 'uuid' },
          status: { $ref: '#/components/schemas/JobStatus' },
          links: { $ref: '#/components/schemas/JobLinks' },
        },
      },
      Progress: {
        type: 'object',
        properties: {
          total: { type: 'integer', example: 40 },
          completed: { type: 'integer', example: 32 },
          failed: { type: 'integer', example: 0 },
          pending: { type: 'integer', example: 8 },
        },
      },
      Job: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          status: { $ref: '#/components/schemas/JobStatus' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          completedAt: { type: 'string', format: 'date-time', nullable: true },
          error: { type: 'string', nullable: true },
          progress: { $ref: '#/components/schemas/Progress' },
          stations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                stationId: { type: 'integer' },
                stationName: { type: 'string' },
                status: { type: 'string', enum: ['pending', 'completed', 'failed'] },
                error: { type: 'string', nullable: true },
              },
            },
          },
          links: { $ref: '#/components/schemas/JobLinks' },
        },
      },
      JobImages: {
        type: 'object',
        properties: {
          jobId: { type: 'string', format: 'uuid' },
          status: { $ref: '#/components/schemas/JobStatus' },
          progress: { $ref: '#/components/schemas/Progress' },
          images: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                stationId: { type: 'integer' },
                stationName: { type: 'string' },
                url: { type: 'string', format: 'uri', description: 'Read-only SAS link to the image.' },
                expiresAt: { type: 'string', format: 'date-time' },
              },
            },
          },
        },
      },
    },
  },
};
