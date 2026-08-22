; case strops-016-concatlen
; expect exit=0 stdout="80\n"
.func main arity=0 locals=0
  PUSH_STR "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
  PUSH_STR "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"
  CONCAT
  LEN
  PRINT
  RET
.end
