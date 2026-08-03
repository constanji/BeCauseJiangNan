package ai.dat.core.data;

import ai.dat.core.data.example.Example;
import ai.dat.core.data.seed.SeedSpec;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Getter;
import lombok.NonNull;
import lombok.Setter;

import java.util.List;

@Setter
@Getter
public class DatSchema {
    @NonNull
    private Integer version = 1;

    @NonNull
    @JsonProperty("seeds")
    private List<SeedSpec> seeds = List.of();

    @JsonProperty("examples")
    private Example example;
}