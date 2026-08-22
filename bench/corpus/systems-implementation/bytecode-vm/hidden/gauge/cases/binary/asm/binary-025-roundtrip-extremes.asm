; case binary-025-roundtrip-extremes
; expect exit=0 stdout=""
.func main arity=0 locals=0
  PUSH_INT -9223372036854775808
  PUSH_INT 9223372036854775807
  PUSH_INT 0
  PUSH_INT -1
  NEW_ARRAY 4
  PRINT
  RET
.end
