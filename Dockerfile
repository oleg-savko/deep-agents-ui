# Build stage
FROM node:18-alpine AS builder

# Install dependencies only when needed
RUN apk add --no-cache libc6-compat

WORKDIR /app

# Copy package files
COPY package.json yarn.lock ./

# Install dependencies
RUN yarn install --frozen-lockfile

# Copy all files
COPY . .

# Accept build arguments for Next.js public environment variables
ARG NEXT_PUBLIC_DEPLOYMENT_URL
ARG NEXT_PUBLIC_AGENT_ID
ARG NEXT_PUBLIC_LANGSMITH_API_KEY
ARG NEXT_PUBLIC_LANGFUSE_PUBLIC_KEY
ARG NEXT_PUBLIC_LANGFUSE_HOST

# Set environment variables for build (these are inlined at build time)
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_DEPLOYMENT_URL=$NEXT_PUBLIC_DEPLOYMENT_URL
ENV NEXT_PUBLIC_AGENT_ID=$NEXT_PUBLIC_AGENT_ID
ENV NEXT_PUBLIC_LANGSMITH_API_KEY=$NEXT_PUBLIC_LANGSMITH_API_KEY
ENV NEXT_PUBLIC_LANGFUSE_PUBLIC_KEY=$NEXT_PUBLIC_LANGFUSE_PUBLIC_KEY
ENV NEXT_PUBLIC_LANGFUSE_HOST=$NEXT_PUBLIC_LANGFUSE_HOST

# Build the application
RUN yarn build

# Production stage
FROM node:18-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create a non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy necessary files from builder
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Set correct permissions
RUN chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
