FROM gcr.io/oss-fuzz-base/base-builder-javascript@sha256:afcfd5b0de9185ac60002fde10dc11415e4994ef4a3d08c506a80693bd6143e0

RUN apt-get update && apt-get install -y make g++ python3

COPY . $SRC/termbeam
WORKDIR $SRC/termbeam

COPY .clusterfuzzlite/build.sh $SRC/build.sh
