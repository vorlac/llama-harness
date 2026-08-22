; case locals-005-maxslots
; expect exit=0 stdout="42\nnil\n"
; num_locals is one byte (SPEC.md section 5.3), so 255 slots is the maximum a
; function can declare and slot 254 is the highest index.
.func main arity=0 locals=255
  PUSH_INT 42
  STORE_LOCAL 254
  LOAD_LOCAL 254
  PRINT
  LOAD_LOCAL 128
  PRINT
  RET
.end
