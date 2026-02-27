import React from "react";
import { Composition, Folder } from "remotion";
import { TermBeamDemo, TOTAL_DUR, FPS } from "./TermBeamDemo";
import { Intro } from "./Intro";
import { CliTerminal } from "./CliTerminal";
import { PhoneScene } from "./PhoneScene";
import { Outro } from "./Outro";
import { TitleCard } from "./TitleCard";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="TermBeamDemo"
        component={TermBeamDemo}
        durationInFrames={TOTAL_DUR}
        fps={FPS}
        width={1920}
        height={1080}
      />
      <Folder name="Scenes">
        <Composition
          id="Intro"
          component={Intro}
          durationInFrames={75}
          fps={FPS}
          width={1920}
          height={1080}
        />
        <Composition
          id="CliTerminal"
          component={CliTerminal}
          durationInFrames={260}
          fps={FPS}
          width={1920}
          height={1080}
        />
        <Composition
          id="PhoneScene"
          component={PhoneScene}
          durationInFrames={300}
          fps={FPS}
          width={1920}
          height={1080}
        />
        <Composition
          id="Outro"
          component={Outro}
          durationInFrames={120}
          fps={FPS}
          width={1920}
          height={1080}
        />
        <Composition
          id="TitleCard-Stack"
          component={() => <TitleCard title="Share Your Terminal" mode="stack" />}
          durationInFrames={40}
          fps={FPS}
          width={1920}
          height={1080}
        />
        <Composition
          id="TitleCard-Slam"
          component={() => <TitleCard title="One Command" mode="slam" subtitle="npx termbeam" />}
          durationInFrames={35}
          fps={FPS}
          width={1920}
          height={1080}
        />
        <Composition
          id="TitleCard-Rapid"
          component={() => <TitleCard title="Scan Tap Connected" mode="rapid" />}
          durationInFrames={45}
          fps={FPS}
          width={1920}
          height={1080}
        />
      </Folder>
    </>
  );
};
