import { SceneName } from "./Scenes";
import { LogMng } from "@/utils/LogMng";
import { Params } from "@/data/Params";

export default class Boot extends Phaser.Scene {

    constructor() {
        super(SceneName.Boot);

        // init debug mode
        Params.isDebugMode = window.location.hash === '#debug';

        // LogMng settings
        if (!Params.isDebugMode) LogMng.setMode(LogMng.MODE_RELEASE);
        LogMng.system('Log mode: ' + LogMng.getMode());

        if (!Params.isDebugMode) console.clear();
    }

    create() {
        this.scene.start(SceneName.Preloader);
    }

}
