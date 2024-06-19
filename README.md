# samsung-aircon-8888-get-token

These instructions are meant to help you getting your Samsung Aircon token (new generations).

The purpose of this project is to help you adding your aircon to HomeAssistant using the [Climate IP Integration](https://github.com/SebuZet/samsungrac)

This project was forked form [martonky/homebridge-samsung-aircon-8888](https://github.com/martonky/homebridge-samsung-aircon-8888)

If you have your Samsung AC working over Port 2878, please check out [this project](https://github.com/SebastianOsinski/HomebridgePluginSamsungAirConditioner).

This allows you to get your Samsung aircont token and add it to HomeAssistant.

## Air Conditioner Versions

This script should work with most of the newest Aircon models, that have an API exposed on port 8888

## Pre-requisites

Make sure that you have docker & git installed.
clone this repository to your machine:
```bash
git clone https://github.com/hmmferreira/samsung-aircon-8888-get-token
```


### Obtain Your Samsung AC Token

#### Assign Static IP

It is highly recommended to assign a static IP to your AC. If you have not done so, please do this via your home router, and restart your AC (cut off power, not via remote only) or router thereafter, to make sure that your AC does have the static IP you have assigned to.

#### Get Token

`cd` to your cloned git repository `samsung-aircon-8888-get-token`, where you'll find the Dockerfile

From the folder:

#### Build docker image

```bash
docker build -t samsumg-aircon-token .
```


#### Run the Docker Container:
```bash
docker run -it --rm -p 8889:8889 samsumg-aircon-token
```

If successful, a docker container will run and listen to the response from your AC. **Open a new Terminal / Shell window**, and type in as follows. **Please do not hit enter to execute this first**.

```bash
curl -k -H "Content-Type: application/json" -H "DeviceToken: xxxxxxxxxxx" --cert ac14k_m.pem --insecure -X POST https://192.168.1.xxx:8888/devicetoken/request
```

Please replace the IP address to your AC's static IP.

Turn off your AC, and then hit enter to run the script curl command. Then turn on your AC again.

Return to the Shell window that is running the docker container. You should see the following:

```
----- Request Start ----->

/devicetoken/response
Host: 192.168.1.xxx:8889
Accept: */*
X-API-Version : v1.0.0
Content-Type: application/json
Content-Length: 28

{"DeviceToken":"xxxxxxxx"}
<__main__.RequestHandler instance at 0x......>
<----- Request End -----
```

Please note down the `DeviceToken` value. This is your AC token.

### Update yout HomeAssistant Config File

Make sure you have Climate IP installed in your HomeAssistante. If you don't please check out their page for more instructions

Add your aircon configuration to your HomeAssistant configuration.yaml file :

```yaml
climate:
  - platform: climate_ip
    config_file: "/config/custom_components/climate_ip/samsungrac.yaml"
    ip_address: <your_aircon_ip_address>
    token: <the_token_from_above>
    name: "My air conditioner name"
```

Check that your yaml file is correct and restart your HomeAssistant. Your aircon should now be available on HomeAssistant. (with a better integration than Samsung SmartThigns app)


## Credit

This project is forked from [martonky/homebridge-samsung-aircon-8888](https://github.com/martonky/homebridge-samsung-aircon-8888) and simplified with Docker. Instructions replaced for HomeAssistant integration.