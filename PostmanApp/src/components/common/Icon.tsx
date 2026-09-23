import React from "react";
import Svg, { Circle, Path } from "react-native-svg";

export type IconName =
  | "home"
  | "list"
  | "map"
  | "user"
  | "chevron"
  | "navigate"
  | "phone"
  | "package"
  | "check"
  | "clock"
  | "alert"
  | "offline"
  | "bell"
  | "sync"
  | "info"
  | "route";

interface Props {
  name: IconName;
  size?: number;
  color: string;
}

/** Line icons (24x24) drawn with react-native-svg: crisp on every screen, no icon font to ship. */
export function Icon({ name, size = 22, color }: Props) {
  const stroke = { stroke: color, strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      {name === "home" && <Path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4v-5H9v5H5a1 1 0 0 1-1-1v-7.5Z" {...stroke} />}
      {name === "list" && <Path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" {...stroke} />}
      {name === "map" && <Path d="m3 6 6-2 6 2 6-2v14l-6 2-6-2-6 2V6ZM9 4v14M15 6v14" {...stroke} />}
      {name === "user" && (
        <>
          <Circle cx={12} cy={8} r={3.6} {...stroke} />
          <Path d="M4.5 20a7.5 7.5 0 0 1 15 0" {...stroke} />
        </>
      )}
      {name === "chevron" && <Path d="m9 6 6 6-6 6" {...stroke} />}
      {name === "navigate" && <Path d="m4 11 16-7-7 16-2-7-7-2Z" {...stroke} />}
      {name === "phone" && (
        <Path d="M6.5 4h3l1.5 4-2 1.3a10 10 0 0 0 5.7 5.7L16 13l4 1.5v3a2 2 0 0 1-2 2A14 14 0 0 1 4.5 6a2 2 0 0 1 2-2Z" {...stroke} />
      )}
      {name === "package" && <Path d="M21 8 12 3 3 8v8l9 5 9-5V8ZM3 8l9 5 9-5M12 13v8" {...stroke} />}
      {name === "check" && <Path d="m5 12.5 4.5 4.5L19 7.5" {...stroke} />}
      {name === "clock" && (
        <>
          <Circle cx={12} cy={12} r={8.5} {...stroke} />
          <Path d="M12 7.5V12l3 2" {...stroke} />
        </>
      )}
      {name === "alert" && <Path d="M12 3.5 2.5 20h19L12 3.5ZM12 10v4.5M12 17.6v.01" {...stroke} />}
      {name === "offline" && <Path d="M3 3l18 18M8.5 8.8A9 9 0 0 0 3 12M5.5 15.4a7 7 0 0 1 2.7-1.7M12 19.5h.01M16 11.5a9 9 0 0 1 5 2M13 8.1A12 12 0 0 1 22 12" {...stroke} />}
      {name === "bell" && <Path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15L6 17ZM10 21h4" {...stroke} />}
      {name === "sync" && <Path d="M20 12a8 8 0 0 1-13.7 5.6M4 12A8 8 0 0 1 17.7 6.4M17.5 3v4h-4M6.5 21v-4h4" {...stroke} />}
      {name === "info" && (
        <>
          <Circle cx={12} cy={12} r={8.5} {...stroke} />
          <Path d="M12 11v5M12 8v.01" {...stroke} />
        </>
      )}
      {name === "route" && (
        <>
          <Circle cx={6} cy={18} r={2.5} {...stroke} />
          <Circle cx={18} cy={6} r={2.5} {...stroke} />
          <Path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5" {...stroke} />
        </>
      )}
    </Svg>
  );
}
