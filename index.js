var inboundChar;
var outboundChar;
var device;
var packet_count = 0;

// Define the CodeLess UUIDs 
var BPP_SVC_UUID = "0783b03e-8535-b5a0-7140-a304d2495cb7";
var RX_CHAR_UUID   = "0783b03e-8535-b5a0-7140-a304d2495cb8";
var TX_CHAR_UUID = "0783b03e-8535-b5a0-7140-a304d2495cba";

var no_data_yet = true;

var ecg_ts = new TimeSeries();
var ppg_ts = new TimeSeries();

var state = 0;
var receivedData = [];
var receivedDataIndex = 0;

var parsed_arr_ecg = [];
var parsed_arr_ppg = [];
var parsed_arr_index = 0;
var xValues = [];
var xyValues = [];

var val_data_compare_ppg = 0.0;
var val_data_compare_ecg = 0.0;
var val_data_compare_last_ppg = 0.0;
var val_data_compare_last_ecg = 0.0;
var val_data_same_start_ppg = 0.0;
var val_data_same_start_ecg = 0.0;
var val_data_same_end_ppg = 0.0;
var val_data_same_end_ecg = 0.0;
var val_line_same_start = 0;
var val_line_same_end = 0;
var g_num_line = 0;

var dataLog = "";

var downsample = 0;

var settingsArr = new Uint8Array(8);

var raw_chart = new SmoothieChart(
    {
        millisPerPixel: 5,
        //timestampFormatter: SmoothieChart.timeFormatter,
        //interpolation: 'linear',
        tooltip: true,
        labels: { fontSize: 15, fillStyle: '#FFFFFF', precision: 0 },
        grid: { borderVisible: false, millisPerLine: 2000, verticalSections: 21, fillStyle: '#000000' }

    }
);

var test_chart = new Chart("bpchart", {
    type: "line",
    data: {
        labels: xValues,
        datasets: [{
            fill: false,
            pointRadius: 1,
            borderColor: "rgba(0,0,255,0.5)",
            //data: parsed_arr_ecg
            data: xyValues
        }]
    },
    options: {
        legend: { display: false },
        scales: {
            xAxes: [{ticks: { display: false }}],
          },
        // title: {
        //     display: true,
        //     text: "y = x * 2 + 7",
        //     fontSize: 16
        // }
    }
});

// Display text in log field text area 
function log(text) {
    var textarea = document.getElementById('log');
    textarea.value += "\n" + text;
    textarea.scrollTop = textarea.scrollHeight;
}

function normalize(arr_in) {
    var arr_ret, val_max, val_min, val_range;
    val_min = Math.min(...arr_in);
    val_max = Math.max(...arr_in);
    val_range = val_max - val_min;

    var arr_ret = arr_in.map( function(value) { 
        return (value - val_min) / val_range;
    } );

    return arr_ret;
  }

// Incoming GATT notification was received
async function incomingData(event) {

    if (no_data_yet) {
        document.getElementById('chart-area').style = "display:inline;";
        raw_chart.start();
        no_data_yet = false;

        for (let x = 0; x < 100; x++) {
            xValues.push(x);
          }
    }

    for (var i = 0; i < event.target.value.byteLength; i++) {
        val = event.target.value.getUint8(i);

        switch (state) {
            case 0:
                if (val == 0xff) {
                    state = 1;
                }
                break;

            case 1:
                if (val == 0xff) {
                    receivedData.length = 0;
                    receivedDataIndex = 0;
                    state = 2;
                }
                else {
                    state = 0;
                }
                break;

            case 2:
                receivedData[receivedDataIndex++] = val;

                if (receivedData.length == 18) {
                    state = 0;

                    // if (++downsample < 5)
                    // {
                    //     break;
                    // }

                    downsample = 0;

                    ppg = 0;
                    ecg = 0;

                    ppg = receivedData[3] << 16;
                    ppg |= receivedData[4] << 8;
                    ppg |= receivedData[5];

                    ecg = receivedData[6] << 16;
                    ecg |= receivedData[7] << 8;
                    ecg |= receivedData[8];

                    if (receivedData[6] > 128) {
                        ecg -= Math.pow(2, 24);
                    }

                    document.getElementById("log").value = "";
                    log('Packet: ' + receivedData[2] + ', ECG: ' + ecg + ', PPG: ' + ppg);
                    dataLog = dataLog + ppg + ', ' + ecg + '\n';

                    interpolate(ppg, ecg);
                    //graphRaw(ppg, ecg);
                }
                break;
        }
    }
}

function graphRaw(ppg, ecg) {
    var time = new Date();

    ppg_ts.append(time, ppg);
    ecg_ts.append(time, ecg);

    parsed_arr_ecg[parsed_arr_index] = ecg;
    parsed_arr_ppg[parsed_arr_index++] = ppg;

    xyValues.length = 0;
    for (var x1 = 0; x1 < parsed_arr_index; x1++) {
        xyValues.push({ x: x1, y: parsed_arr_ecg[x1] });
    }

    if (parsed_arr_index >= 100) {
        var ecg_arr = normalize(parsed_arr_ecg);
        var ppg_arr = normalize(parsed_arr_ppg);

        // for (var j = 0; j < parsed_arr_index; j++)
        // {
        //     var time = new Date();

        //     //ppg_ts.append(time, ppg_arr[j]);
        //     //ecg_ts.append(time, ecg_arr[j]);
        // }

        parsed_arr_index--;
        parsed_arr_ecg.shift();
        //test_chart.update();
    }
}

async function onDisconnected() {
    log("Bluetooth connection terminated!");
}

async function bleDisconnect() {

    createSettings();

    if (device != null) {
        if (device.gatt.connected) {
            log("Disconnecting");
            device.gatt.disconnect();
        }
        else {
            log('> Bluetooth Device is already disconnected');
        }
    }
}

// Scan, connect and explore CodeLess BLE device
async function ble_connect() {
    try {
        // Define a scan filter and prepare for interaction with Codeless Service
        log('Requesting Bluetooth Device...');
        device = await navigator.bluetooth.requestDevice({
            filters: [{ name: 'BPP' }],
            optionalServices: [BPP_SVC_UUID]
        });
        device.addEventListener('gattserverdisconnected', onDisconnected);
        // Connect to device GATT and perform attribute discovery
        server = await device.gatt.connect();
        const service = await server.getPrimaryService(BPP_SVC_UUID);
        const flowcontrolChar = await service.getCharacteristic(RX_CHAR_UUID);
        const txChar = await service.getCharacteristic(TX_CHAR_UUID);

        createSettings();

        txChar.writeValue(settingsArr);
        // Subscribe to notifications
        await flowcontrolChar.startNotifications();
        flowcontrolChar.addEventListener('characteristicvaluechanged', incomingData);
        log('Ready to communicate!\n');
    }
    catch (error) {
        log('Failed: ' + error);
    }
}

function createTimeline() {
    document.getElementById('rawchart').width = document.getElementById('stage').clientWidth * 0.95;
    //document.getElementById('bpchart').width = document.getElementById('stage').clientWidth * 0.95;

    raw_chart.addTimeSeries(ppg_ts, {
        strokeStyle: 'rgba(128, 0, 128, 1)',
        lineWidth: 2

    });

    raw_chart.addTimeSeries(ecg_ts, {
        strokeStyle: 'rgba(255, 0, 0, 1)',
        lineWidth: 2
    });

    raw_chart.streamTo(document.getElementById("rawchart"), 1000);
}

function calcChecksum()
{
    var    i   = 0;
    var     bcc = 0;

    for (var i = 0; i < 7; i++ )
    {
        /* cast */
        bcc ^= settingsArr[i]
    }

    settingsArr[7] = bcc;
}

function createSettings() {
    settingsArr[0] = 0x55;
    settingsArr[4] = parseInt(document.getElementById("gender").value, 10);
    settingsArr[6] = parseInt(document.getElementById("mode").value, 10);
    settingsArr[5] = parseInt(document.getElementById("style").value, 10);
    settingsArr[1] = parseInt(document.getElementById("height").value, 10);
    settingsArr[2] = parseInt(document.getElementById("weight").value, 10);
    settingsArr[3] = parseInt(document.getElementById("age").value, 10);

    calcChecksum();
}

function adjust_width() {
    //document.getElementById('vitalchart').width = document.getElementById('stage').clientWidth * 0.95;
    document.getElementById('rawchart').width = document.getElementById('stage').clientWidth * 0.95;
}

function interpolate(val_ppg, val_ecg) {
    var coef_a_ecg, coef_a_ppg, coef_b_ecg,
        coef_b_ppg, val_data_interpolate_ecg, 
        val_data_interpolate_ppg;

    val_data_compare_ppg = val_ppg;
    val_data_compare_ecg = val_ecg;

    if (val_data_compare_ecg !== val_data_compare_last_ecg && g_num_line !== 0) {
        val_line_same_end = g_num_line;
        val_data_same_end_ppg = val_data_compare_ppg;
        val_data_same_end_ecg = val_data_compare_ecg;
        coef_a_ppg = (val_data_same_start_ppg - val_data_same_end_ppg) / (val_line_same_start - val_line_same_end);
        coef_a_ecg = (val_data_same_start_ecg - val_data_same_end_ecg) / (val_line_same_start - val_line_same_end);
        coef_b_ppg = -1 * coef_a_ppg * val_line_same_start + val_data_same_start_ppg;
        coef_b_ecg = -1 * coef_a_ecg * val_line_same_start + val_data_same_start_ecg;

        for (var x = val_line_same_start, _pj_a = val_line_same_end; x < _pj_a; x += 1) {
            val_data_interpolate_ppg = coef_a_ppg * x + coef_b_ppg;
            val_data_interpolate_ecg = coef_a_ecg * x + coef_b_ecg;

            graphRaw(val_data_interpolate_ppg, val_data_interpolate_ecg);
        }

        val_line_same_start = g_num_line;
        val_data_same_start_ppg = val_data_compare_ppg;
        val_data_same_start_ecg = val_data_compare_ecg;
    }
    g_num_line += 1;
    val_data_compare_last_ppg = val_data_compare_ppg;
    val_data_compare_last_ecg = val_data_compare_ecg;

}

function save(filename, data) {
    if (document.getElementById('savebutton').value == 'Save') {
        document.getElementById('savebutton').value = 'Saving';
        document.getElementById("savebutton").classList.remove('button3');
        document.getElementById("savebutton").classList.add('button3_on');
        dataLog = "";
    }
    else {
        document.getElementById('savebutton').value = 'Save';
        document.getElementById("savebutton").classList.remove('button3_on');
        document.getElementById("savebutton").classList.add('button3');

        //     data = csvHeader + data;
        const blob = new Blob([data], { type: 'text/csv' });
        if (window.navigator.msSaveOrOpenBlob) {
            window.navigator.msSaveBlob(blob, filename);
        }
        else {
            const elem = window.document.createElement('a');
            elem.href = window.URL.createObjectURL(blob);
            elem.download = filename;
            document.body.appendChild(elem);
            elem.click();
            document.body.removeChild(elem);
        }
    }
}