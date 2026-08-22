; The worked example of SPEC.md section 5.5.
; Assembles to exactly 83 bytes; see smoke.svm.hex.
.func main arity=0 locals=0
  PUSH_STR "hello, svm"
  PRINT
  PUSH_INT 6
  PUSH_INT 7
  MUL
  PRINT
  RET
.end
