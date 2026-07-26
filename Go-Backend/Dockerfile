# syntax=docker/dockerfile:1
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/stylme-ai ./cmd/api

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/stylme-ai /stylme-ai
EXPOSE 8081
ENTRYPOINT ["/stylme-ai"]
