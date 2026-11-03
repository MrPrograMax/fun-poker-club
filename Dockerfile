FROM golang:1.26-alpine AS build
WORKDIR /app
COPY go.mod ./
COPY *.go ./
COPY dist ./dist
RUN CGO_ENABLED=0 go build -trimpath -o /river-poker .

FROM alpine:3.22
RUN addgroup -S poker && adduser -S poker -G poker && mkdir /data && chown poker:poker /data
USER poker
COPY --from=build /river-poker /river-poker
ENV LISTEN_ADDR=0.0.0.0:8080 DATA_DIR=/data
EXPOSE 8080
VOLUME ["/data"]
ENTRYPOINT ["/river-poker"]
