# ReplicatedStorage/Remotes

RemoteEvents and RemoteFunctions live here.

Convention: create remotes in code (server creates, clients use
`WaitForChild`), or model them as `.model.json` files. Every remote that
mutates state MUST be validated on the server — never trust client input.
