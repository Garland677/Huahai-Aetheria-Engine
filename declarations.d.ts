declare module 'localforage' {
    export interface LocalForageDbInstanceOptions {
        name?: string;
        storeName?: string;
        version?: number;
        description?: string;
        driver?: string | string[];
        size?: number;
    }

    export interface LocalForage {
        getItem<T>(key: string, callback?: (err: any, value: T | null) => void): Promise<T | null>;
        setItem<T>(key: string, value: T, callback?: (err: any, value: T) => void): Promise<T>;
        removeItem(key: string, callback?: (err: any) => void): Promise<void>;
        clear(callback?: (err: any) => void): Promise<void>;
        length(callback?: (err: any, numberOfKeys: number) => void): Promise<number>;
        key(keyIndex: number, callback?: (err: any, key: string) => void): Promise<string>;
        keys(callback?: (err: any, keys: string[]) => void): Promise<string[]>;
        iterate<T, U>(iteratee: (value: T, key: string, iterationNumber: number) => U, callback?: (err: any, result: U) => void): Promise<U>;
        
        config(options: LocalForageDbInstanceOptions): boolean;
        config(): LocalForageDbInstanceOptions;
        
        createInstance(options: LocalForageDbInstanceOptions): LocalForage;
        driver(): string;
        ready(): Promise<void>;
        supports(driverName: string): boolean;
        
        INDEXEDDB: string;
        WEBSQL: string;
        LOCALSTORAGE: string;
    }

    const localforage: LocalForage;
    export default localforage;
}
