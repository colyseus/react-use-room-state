import { createContext, useState, useEffect, useContext, useMemo } from "react";
import { Client, Room, getStateCallbacks } from "colyseus.js";
import { GetCallbackProxy } from "@colyseus/schema";
import { MyRoomState } from "../schema/MyRoomState";

const ColyseusContext = createContext<{
  room: any;
  $: GetCallbackProxy | null;
}>({
  room: null,
  $: null,
});

export const useColyseusContext = () => {
  return useContext(ColyseusContext);
};

export const client = new Client("http://localhost:2567");

export const ColyseusProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [mounted, setMounted] = useState(false);
  const [room, setRoom] = useState<Room<any> | null>(null);

  useEffect(() => {
    if (!mounted) {
      client
        .joinOrCreate<MyRoomState>("my_room")
        .then((room) => {
          setRoom(room);
          setMounted(true);
          return room;
        })
        .catch((err) => {
          // handle errors
          console.log(`Error joining room: ${err}`);
        });

      return () => {
        if (room) {
          room.leave();
        }
      };
    }
  }, [room, mounted]);

  return (
    <ColyseusContext.Provider
      value={{
        room,
        $: room ? getStateCallbacks(room) : null,
      }}
    >
      {!room ? <p>Loading Game...</p> : children}
    </ColyseusContext.Provider>
  );
};
