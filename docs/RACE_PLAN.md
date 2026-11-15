# Race Plan (iRacePlan)

Tearoff can load an endurance race plan from [iRacePlan](https://iraceplan.com)
so the team can see it during the race. Plans are read-only in Tearoff: make
changes in iRacePlan and they show up after the next refresh.

iRacing only: a plan names its drivers, team and track by their iRacing ids,
which Le Mans Ultimate does not report. The Stint Plan and Strategy Timeline
overlays are hidden while Le Mans Ultimate is the running sim.

## Setup

1. In iRacePlan, open your account settings and create an API key.
2. In Tearoff, open **Settings → Race Plan**.
3. Paste the key into **API key** and press **Save**. The key is encrypted with
   Windows and stored on this PC only. It is only ever sent to iRacePlan.
4. Choose the event:
   - press **Load list** and pick it from **Planning** (team plannings are
     marked "(team)"), or
   - type the planning ID into **Planning ID** and press **Use**. The ID is
     the number at the end of the planning's address in iRacePlan.

   Tearoff loads the planning before switching to it. If iRacePlan can't
   find it, or can't be reached, a message shows under the box and the
   current planning stays in use.

5. If the planning has more than one strategy, pick one under **Strategy**.
   Otherwise the first one is used.

The **Summary** shows the event, track, car, race start and how many stints
each driver has. Check it matches iRacePlan.

## Updates

Tearoff reloads the plan every 5 minutes by default (1 to 30 minutes under
**Refresh every**), or straight away with **Refresh now**.

The last plan that loaded is saved on this PC. If iRacePlan can't be reached
during the race, Tearoff keeps showing the saved plan and the status line
shows when it was saved.

## Status messages

| Message                                    | What to do                                                                              |
| ------------------------------------------ | --------------------------------------------------------------------------------------- |
| iRacePlan rejected the API key             | Create a new key in iRacePlan and save it again.                                        |
| iRacePlan has no planning with ID ...      | Check the ID, and that your account can see the planning. The planning was not changed. |
| Could not reach iRacePlan                  | Check your connection. The saved plan stays in use.                                     |
| iRacePlan sent data Tearoff could not read | iRacePlan may have changed its data. Please report it.                                  |
| This PC cannot encrypt the API key         | Windows secure storage isn't available, so the key can't be saved.                      |
