FROM gcr.io/oss-fuzz-base/base-builder-javascript

RUN apt-get update && apt-get install -y make g++ python3

COPY . $SRC/termbeam
WORKDIR $SRC/termbeam

COPY .clusterfuzzlite/build.sh $SRC/build.sh
